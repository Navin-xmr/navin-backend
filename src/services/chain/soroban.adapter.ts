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
   * Invocation pipeline: simulate -> assemble -> sign -> send -> poll
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
      throw new AppError(400, 'Soroban sendTransaction failed', ErrorCodes.CHAIN_UNKNOWN);
    }

    // 5. Poll
    const txHash = sendRes.hash;
    let statusRes: rpc.Api.GetTransactionResponse;
    const startTime = Date.now();
    const timeoutMs = 30000;

    for (;;) {
      statusRes = await this.server.getTransaction(txHash);
      if (statusRes.status === 'SUCCESS') {
        return { txHash, ledger: statusRes.ledger };
      }
      if (statusRes.status === 'FAILED') {
        throw new AppError(
          400,
          'Soroban transaction execution failed on-chain',
          ErrorCodes.CHAIN_UNKNOWN
        );
      }
      if (Date.now() - startTime > timeoutMs) {
        throw new AppError(504, 'Soroban transaction polling timed out', ErrorCodes.CHAIN_UNKNOWN);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
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
