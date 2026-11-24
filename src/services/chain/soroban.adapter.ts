import {
  rpc,
  Contract,
  Address,
  nativeToScVal,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { config } from '../../config/index.js';
import { instrumentSubmission } from '../../infra/metrics/chainMetrics.js';
import { stellarNetworkPassphrase } from '../../config/stellarNetwork.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import {
  AddressSchema,
  Bytes32HexSchema,
  SymbolSchema,
  parseChainEvent,
  UpdateStatusArgsSchema,
  chainErrorToAppError,
  updateStatusErrorToAppError,
} from '../../shared/types/chain.js';
import type { ChainEvent } from '../../shared/types/chain.js';
import type {
  AnchorEventInput,
  AnchorResult,
  ChainAdapter,
  ChainEventCursor,
  ConfirmDeliveryInput,
  ConfirmDeliveryResult,
  EscrowResult,
  ReleaseEscrowInput,
  UpdateStatusInput,
  UpdateStatusResult,
} from './types.js';

export interface SorobanAdapterOptions {
  sorobanRpcUrl?: string;
  contractId?: string;
  secretKey?: string;
  networkPassphrase?: string;
  rpcServer?: rpc.Server;
}

export class SorobanAdapter implements ChainAdapter {
  private readonly server: rpc.Server;
  private readonly contractId: string;
  private readonly secretKey: string | undefined;
  private readonly networkPassphrase: string;

  constructor(options: SorobanAdapterOptions = {}) {
    const rpcUrl = options.sorobanRpcUrl ?? config.sorobanRpcUrl;
    this.server = options.rpcServer ?? new rpc.Server(rpcUrl);
    this.contractId = options.contractId ?? config.escrowContractId ?? '';
    this.secretKey = options.secretKey ?? config.stellarSecretKey;
    this.networkPassphrase =
      options.networkPassphrase ?? stellarNetworkPassphrase(config.stellarNetwork);
  }

  private signer(): Keypair {
    if (!this.secretKey) {
      throw new AppError(500, 'STELLAR_SECRET_KEY is not configured', ErrorCodes.CHAIN_UNKNOWN);
    }
    return Keypair.fromSecret(this.secretKey);
  }

  private getContract(): Contract {
    if (!this.contractId) {
      throw new AppError(500, 'ESCROW_CONTRACT_ID is not configured', ErrorCodes.CHAIN_UNKNOWN);
    }
    return new Contract(this.contractId);
  }

  anchorEvent(input: AnchorEventInput): Promise<AnchorResult> {
    return instrumentSubmission('anchor_event', () => this.doAnchorEvent(input));
  }

  private async doAnchorEvent(input: AnchorEventInput): Promise<AnchorResult> {
    if (!Bytes32HexSchema.safeParse(input.data_hash).success) {
      throw new AppError(
        422,
        'data_hash must be 32 bytes of lowercase hex',
        ErrorCodes.CHAIN_INVALID_HASH
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'anchor',
      nativeToScVal(input.shipment_id, { type: 'symbol' }),
      nativeToScVal(Buffer.from(input.data_hash, 'hex'), { type: 'bytes' }),
      new Address(input.actor).toScVal()
    );

    const { txHash, ledger } = await this.invokePipeline(op);
    return { txHash, ledger, simulated: false };
  }

  releaseEscrow(input: ReleaseEscrowInput): Promise<EscrowResult> {
    return instrumentSubmission('release_escrow', () => this.doReleaseEscrow(input));
  }

  private async doReleaseEscrow(input: ReleaseEscrowInput): Promise<EscrowResult> {
    // v2 (#1056): real contract signature is (caller, shipment_id). Escrow is
    // per-shipment, so no payment_id/proof_hash are invented here.
    if (!AddressSchema.safeParse(input.caller).success) {
      throw new AppError(
        422,
        'caller must be a valid Stellar address',
        ErrorCodes.CHAIN_UNAUTHORIZED
      );
    }
    if (!SymbolSchema.safeParse(input.shipment_id).success) {
      throw new AppError(
        422,
        'shipment_id must be a valid Soroban Symbol',
        ErrorCodes.CHAIN_UNKNOWN
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'release_escrow',
      new Address(input.caller).toScVal(),
      nativeToScVal(input.shipment_id, { type: 'symbol' })
    );

    const { txHash, ledger } = await this.invokePipeline(op);
    return { txHash, ledger, simulated: false, shipmentId: input.shipment_id };
  }

  async updateStatus(input: UpdateStatusInput): Promise<UpdateStatusResult> {
    // Validates against the real ABI: caller Address, shipment_id u64, ShipmentStatus
    // variant name, data_hash BytesN<32>. Fails before any RPC call.
    const parsed = UpdateStatusArgsSchema.safeParse(input);
    if (!parsed.success) {
      const hashIssue = parsed.error.issues.some(i => i.path[0] === 'data_hash');
      throw new AppError(
        422,
        'update_status arguments do not match the contract ABI',
        hashIssue ? ErrorCodes.CHAIN_INVALID_HASH : ErrorCodes.CHAIN_UNKNOWN,
        parsed.error.issues
      );
    }
    const args = parsed.data;

    const contract = this.getContract();
    const op = contract.call(
      'update_status',
      new Address(args.caller).toScVal(),
      nativeToScVal(BigInt(args.shipment_id), { type: 'u64' }),
      // #[contracttype] unit-variant enum == ScVal vec [Symbol(VariantName)]
      nativeToScVal([args.new_status], { type: ['symbol'] }),
      // data_hash is forwarded exactly as supplied — hex -> 32 raw bytes, no hashing.
      nativeToScVal(Buffer.from(args.data_hash, 'hex'), { type: 'bytes' })
    );

    const { txHash, ledger } = await this.invokePipeline(op, updateStatusErrorToAppError);
    return {
      txHash,
      ledger,
      simulated: false,
      shipmentId: args.shipment_id,
      newStatus: args.new_status,
    };
  }

  async *streamEvents(cursor?: ChainEventCursor): AsyncIterable<ChainEvent> {
    if (!this.contractId) return;

    let startLedger: number | undefined;
    if (cursor && /^\d+$/.test(cursor)) {
      startLedger = parseInt(cursor, 10);
    }

    try {
      const filters: rpc.Api.EventFilter[] = [{ type: 'contract', contractIds: [this.contractId] }];
      const request: rpc.Api.GetEventsRequest = cursor
        ? { cursor, filters }
        : { startLedger: startLedger ?? 0, filters };

      const response = await this.server.getEvents(request);

      for (const rawEvent of response.events ?? []) {
        try {
          const parsed = parseChainEvent({
            id: rawEvent.id,
            contract_id: rawEvent.contractId,
            tx_hash: rawEvent.txHash,
            ledger: rawEvent.ledger,
            ledger_closed_at: rawEvent.ledgerClosedAt,
            name: rawEvent.topic?.[0],
            topic: rawEvent.topic,
            data: rawEvent.value,
          });
          yield parsed;
        } catch {
          // Skip unparseable / off-spec events
          continue;
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'Failed to fetch Soroban events', ErrorCodes.CHAIN_UNKNOWN, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getConfirmationCount(ledger: number): Promise<number> {
    try {
      const latest = await this.server.getLatestLedger();
      return Math.max(0, latest.sequence - ledger);
    } catch (err) {
      throw new AppError(502, 'Failed to fetch latest Soroban ledger', ErrorCodes.CHAIN_UNKNOWN, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Polling configuration for transaction confirmation (P12-06).
   * Bounded exponential backoff with hard timeout.
   */
  private readonly pollingConfig = {
    initialIntervalMs: 500,
    maxIntervalMs: 5000,
    timeoutMs: 60000, // 1 minute hard timeout
    multiplier: 1.5,
  };

  /**
   * P12-12: Confirm delivery and release escrow via contract's `confirm_delivery`.
   * Co-emits delivery_confirmed + escrow_released.
   * Uses contract's idempotency_key for deduplication (P13-06).
   */
  async confirmDelivery(input: {
    receiver: string;
    shipment_id: string;
    amount?: string;
    idempotency_key?: string;
  }): Promise<ConfirmDeliveryResult> {
    return instrumentSubmission('confirm_delivery', async () => {
      // Validate inputs
      if (!AddressSchema.safeParse(input.receiver).success) {
        throw new AppError(
          422,
          'receiver must be a valid Stellar address',
          ErrorCodes.CHAIN_UNAUTHORIZED
        );
      }
      if (!SymbolSchema.safeParse(input.shipment_id).success) {
        throw new AppError(
          422,
          'shipment_id must be a valid Soroban Symbol',
          ErrorCodes.CHAIN_UNKNOWN
        );
      }

      const contract = this.getContract();
      const op = contract.call(
        'confirm_delivery',
        new Address(input.receiver).toScVal(),
        nativeToScVal(input.shipment_id, { type: 'symbol' }),
        // amount: optional for partial vs full release
        input.amount
          ? nativeToScVal(BigInt(input.amount), { type: 'i128' })
          : nativeToScVal(null, { type: 'void' }),
        // idempotency_key: optional
        input.idempotency_key
          ? nativeToScVal(input.idempotency_key, { type: 'symbol' })
          : nativeToScVal(null, { type: 'void' })
      );

      const { txHash, ledger } = await this.invokePipeline(op);

      // Determine if partial release based on whether amount was specified
      const partial = !!input.amount;

      return {
        txHash,
        ledger,
        simulated: false,
        shipmentId: input.shipment_id,
        partial,
      };
    });
  }

  /**
   * Invocation pipeline: simulate -> assemble -> sign -> send -> poll
   * P12-12: Always goes through the contract - no simulated path for soroban mode.
   * P12-06: Bounded backoff polling with configurable interval and hard timeout.
   * P13-06: Uses RPC event id as fallback for duplicate detection.
   */
  private async invokePipeline(
    op: ReturnType<Contract['call']>,
    decodeContractError: (code: number) => AppError = chainErrorToAppError
  ): Promise<{ txHash: string; ledger: number }> {
    const keypair = this.signer();
    const sourceAccount = await this.server.getAccount(keypair.publicKey()).catch(() => {
      throw new AppError(502, 'Failed to load account from Soroban RPC', ErrorCodes.CHAIN_UNKNOWN);
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    // 1. Simulate
    const simRes = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simRes)) {
      const contractErrorMatch = String(simRes.error).match(/Error\(Contract, #(\d+)\)/);
      if (contractErrorMatch?.[1]) {
        throw decodeContractError(parseInt(contractErrorMatch[1], 10));
      }
      throw new AppError(400, 'Soroban simulation failed', ErrorCodes.CHAIN_UNKNOWN);
    }

    // 2. Assemble
    const assembled = rpc.assembleTransaction(tx, simRes).build();

    // 3. Sign
    assembled.sign(keypair);

    // 4. Send
    const sendRes = await this.server.sendTransaction(assembled);
    if (sendRes.status === 'ERROR') {
      // P13-06: Handle duplicate transaction (re-submission after network issue)
      const errorStr = String(sendRes.error ?? '');
      if (errorStr.includes('DUPLICATE') || errorStr.includes('already exists')) {
        // Already submitted - poll for existing result
        return this.pollForConfirmation(sendRes.hash);
      }
      throw new AppError(400, 'Soroban sendTransaction failed', ErrorCodes.CHAIN_UNKNOWN, {
        error: sendRes.error,
      });
    }

    // 5. Poll with bounded backoff and timeout (P12-06)
    return this.pollForConfirmation(sendRes.hash);
  }

  /**
   * Poll for transaction confirmation with exponential backoff (P12-06).
   * Returns { txHash, ledger } only on confirmed SUCCESS.
   * Throws actionable error on timeout, not silent failure.
   */
  private async pollForConfirmation(txHash: string): Promise<{ txHash: string; ledger: number }> {
    const { initialIntervalMs, maxIntervalMs, timeoutMs, multiplier } = this.pollingConfig;
    let intervalMs = initialIntervalMs;
    const startTime = Date.now();

    for (;;) {
      const statusRes = await this.server.getTransaction(txHash);

      if (statusRes.status === 'SUCCESS') {
        return { txHash, ledger: statusRes.ledger };
      }

      if (statusRes.status === 'FAILED') {
        // P13-06: Distinguish transaction failure modes
        if ('resultCode' in statusRes && statusRes.resultCode?.includes('tx')) {
          throw new AppError(
            400,
            'Soroban transaction failed on-chain',
            ErrorCodes.CHAIN_TRANSACTION_FAILED,
            { txHash, resultXdr: statusRes.resultXdr }
          );
        }
        throw new AppError(
          400,
          'Soroban transaction execution failed on-chain',
          ErrorCodes.CHAIN_UNKNOWN,
          { txHash }
        );
      }

      // P13-06: Handle NOT_FOUND (re-org or RPC lag)
      if (statusRes.status === 'NOT_FOUND') {
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
          throw new AppError(
            504,
            `Transaction not found after ${timeoutMs}ms. Possible re-org or RPC lag. ` +
              `TxHash: ${txHash}. Retry with same idempotency key.`,
            ErrorCodes.CHAIN_TIMEOUT,
            { txHash, elapsedMs: elapsed }
          );
        }
        // Wait with exponential backoff
        await this.sleep(intervalMs);
        intervalMs = Math.min(intervalMs * multiplier, maxIntervalMs);
        continue;
      }

      // P12-06: TRY_AGAIN_LATER (temporary failure, retry with backoff)
      if (statusRes.status === 'TRY_AGAIN_LATER') {
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
          throw new AppError(
            504,
            `Transaction pending too long (${timeoutMs}ms). Try again later.`,
            ErrorCodes.CHAIN_TRY_AGAIN_LATER,
            { txHash, elapsedMs: elapsed }
          );
        }
        // Wait with exponential backoff
        await this.sleep(intervalMs);
        intervalMs = Math.min(intervalMs * multiplier, maxIntervalMs);
        continue;
      }

      // Pending - continue polling
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        throw new AppError(
          504,
          `Transaction polling timed out after ${timeoutMs}ms. ` +
            `Last status: ${statusRes.status}. TxHash: ${txHash}`,
          ErrorCodes.CHAIN_TIMEOUT,
          { txHash, elapsedMs: elapsed, lastStatus: statusRes.status }
        );
      }

      await this.sleep(intervalMs);
      intervalMs = Math.min(intervalMs * multiplier, maxIntervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Latest ledger sequence reported by the RPC node (#818). */
  async getLatestLedger(): Promise<number> {
    const latest = await this.server.getLatestLedger();
    return latest.sequence;
  }

  /** Ledger containing a successful transaction; null if not found or not successful (#818). */
  async getTransactionLedger(txHash: string): Promise<number | null> {
    const res = await this.server.getTransaction(txHash);
    if (res.status === 'SUCCESS') {
      return (res as { ledger: number }).ledger;
    }
    return null;
  }
}
