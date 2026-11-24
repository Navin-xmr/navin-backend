import {
  rpc,
  Account,
  Contract,
  Address,
  contract as contractClient,
  nativeToScVal,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';
import { config } from '../../config/index.js';
import { instrumentSubmission } from '../../infra/metrics/chainMetrics.js';
import { stellarNetworkPassphrase } from '../../config/stellarNetwork.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { logger } from '../../shared/logger/logger.js';
import {
  AddressSchema,
  Bytes32HexSchema,
  SymbolSchema,
  parseChainEvent,
  isChainEventDecodeFailure,
  UpdateStatusArgsSchema,
  chainErrorToAppError,
  updateStatusErrorToAppError,
} from '../../shared/types/chain.js';
import type { ChainEvent, ChainEventDecodeFailure } from '../../shared/types/chain.js';
import {
  decodeAddress,
  decodeI128,
  decodeShipment,
  decodeShipmentStatus,
  decodeU32,
} from './decoders.js';
import { buildIdempotencyKey, ReceiptCache } from './idempotency.js';
import { runChainPreflight } from './preflight.js';
import type { ChainPreflightConfig, ChainStateReader, PreflightSubject } from './preflight.js';
import { retryWithBackoff } from './retry.js';
import type { RetryPolicy } from './retry.js';
import { SorobanStateReader } from './soroban.state-reader.js';
import type {
  AnchorEventInput,
  AnchorResult,
  ChainAdapter,
  ChainEventCursor,
  ChainShipmentId,
  ChainShipmentRecord,
  ChainShipmentStatus,
  ChainSubmitOptions,
  ChainTxReceipt,
  ConfirmDeliveryInput,
  ConfirmDeliveryResult,
  EscrowResult,
  ReleaseEscrowInput,
  UpdateStatusInput,
  UpdateStatusResult,
} from './types.js';
import { enforceSorobanResourceBudget } from './fee-policy.js';
import { serializeSubmission } from './sequence-lock.js';

/** Contract rejections that mean "this exact thing was already done". */
const DUPLICATE_CODES: ReadonlySet<string> = new Set([
  ErrorCodes.CHAIN_ALREADY_ANCHORED,
  ErrorCodes.CHAIN_ESCROW_ALREADY_RELEASED,
]);

/**
 * `NavinError::ShipmentNotFound` in the shipment contract ABI. Read directly
 * rather than through CHAIN_ERROR_MAP, whose v1 codes don't match the real
 * contract (4 is EscrowExists there); P11-08 replaces that map.
 */
const SHIPMENT_NOT_FOUND = 4;

export interface SorobanAdapterOptions {
  sorobanRpcUrl?: string;
  contractId?: string;
  secretKey?: string;
  networkPassphrase?: string;
  rpcServer?: rpc.Server;
  /** Preflight settings (#1081). Defaults to `config.chainPreflight`. */
  preflight?: ChainPreflightConfig;
  /** Reader the preflight checks use. Defaults to a `SorobanStateReader` on this RPC server. */
  stateReader?: ChainStateReader;
  /** Submission retry policy (#1078). Defaults to `config.chainSubmit`. */
  retry?: RetryPolicy;
  /** Test seam for the backoff wait between retries. */
  sleep?: (ms: number) => Promise<void>;
  /** How long to poll for a sent transaction before reporting a timeout. Default 30s. */
  pollTimeoutMs?: number;
  /** Delay between polls. Default 1s. */
  pollIntervalMs?: number;
}

export class SorobanAdapter implements ChainAdapter {
  private readonly server: rpc.Server;
  private readonly contractId: string;
  private readonly secretKey: string | undefined;
  private readonly networkPassphrase: string;
  private readonly preflightConfig: ChainPreflightConfig;
  private readonly retryPolicy: RetryPolicy;
  private readonly sleep: ((ms: number) => Promise<void>) | undefined;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private stateReader: ChainStateReader | undefined;
  /** Completed submissions by idempotency key (#1078). */
  private readonly receipts = new ReceiptCache();
  /** Submissions in flight by idempotency key, so concurrent repeats share one. */
  private readonly inflight = new Map<string, Promise<ChainTxReceipt>>();

  constructor(options: SorobanAdapterOptions = {}) {
    const rpcUrl = options.sorobanRpcUrl ?? config.sorobanRpcUrl;
    this.server = options.rpcServer ?? new rpc.Server(rpcUrl);
    this.contractId = options.contractId ?? config.escrowContractId ?? '';
    this.secretKey = options.secretKey ?? config.stellarSecretKey;
    this.networkPassphrase =
      options.networkPassphrase ?? stellarNetworkPassphrase(config.stellarNetwork);
    this.preflightConfig = options.preflight ?? {
      enabled: config.chainPreflight.enabled,
      checks: config.chainPreflight.checks,
    };
    this.retryPolicy = options.retry ?? {
      maxAttempts: config.chainSubmit.maxAttempts,
      baseDelayMs: config.chainSubmit.backoffMs,
      maxDelayMs: config.chainSubmit.backoffMaxMs,
    };
    this.sleep = options.sleep;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 30_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.stateReader = options.stateReader;
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

  anchorEvent(input: AnchorEventInput, options?: ChainSubmitOptions): Promise<AnchorResult> {
    return instrumentSubmission('anchor_event', () => this.doAnchorEvent(input, options));
  }

  private async doAnchorEvent(
    input: AnchorEventInput,
    options?: ChainSubmitOptions
  ): Promise<AnchorResult> {
    if (!Bytes32HexSchema.safeParse(input.data_hash).success) {
      throw new AppError(
        422,
        'data_hash must be 32 bytes of lowercase hex',
        ErrorCodes.CHAIN_INVALID_HASH
      );
    }

    const contract = this.getContract();
    const key = this.idempotencyKey('anchor', options, input.shipment_id);

    return this.submitOnce(key, async () => {
      await this.preflight({ actor: input.actor });

      const op = contract.call(
        'anchor',
        nativeToScVal(input.shipment_id, { type: 'symbol' }),
        nativeToScVal(Buffer.from(input.data_hash, 'hex'), { type: 'bytes' }),
        new Address(input.actor).toScVal()
      );

      const { txHash, ledger } = await serializeSubmission(this.signer().publicKey(), () =>
        this.submitWithRetry(op)
      );
      return { txHash, ledger, simulated: false };
    });
  }

  releaseEscrow(input: ReleaseEscrowInput, options?: ChainSubmitOptions): Promise<EscrowResult> {
    return instrumentSubmission('release_escrow', () => this.doReleaseEscrow(input, options));
  }

  private async doReleaseEscrow(
    input: ReleaseEscrowInput,
    options?: ChainSubmitOptions
  ): Promise<EscrowResult> {
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
    const key = this.idempotencyKey(
      'release_escrow',
      options,
      options?.shipmentId ?? input.shipment_id
    );

    return this.submitOnce(key, async () => {
      await this.preflight({});

      const op = contract.call(
        'release_escrow',
        new Address(input.caller).toScVal(),
        nativeToScVal(input.shipment_id, { type: 'symbol' })
      );

      const { txHash, ledger } = await serializeSubmission(this.signer().publicKey(), () =>
        this.submitWithRetry(op)
      );
      return { txHash, ledger, simulated: false, shipmentId: input.shipment_id };
    });
  }

  /**
   * Idempotency key for a submission, or undefined when the caller gave no
   * event identity. The method name is part of the key so an anchor and a
   * release with the same (shipment, event, counter) never share a receipt.
   */
  private idempotencyKey(
    method: 'anchor' | 'release_escrow',
    options: ChainSubmitOptions | undefined,
    shipmentId: string
  ): string | undefined {
    if (!options) return undefined;
    return `${method}:${buildIdempotencyKey({
      shipmentId,
      eventType: options.eventType,
      eventCounter: options.eventCounter,
    })}`;
  }

  /**
   * Run `submit` at most once per idempotency key: a completed key returns its
   * original receipt, and a concurrent repeat joins the call already in flight.
   */
  private async submitOnce<T extends ChainTxReceipt>(
    key: string | undefined,
    submit: () => Promise<T>
  ): Promise<T> {
    if (!key) return submit();

    const completed = this.receipts.get(key);
    if (completed) return completed as T;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = submit()
      .then(receipt => {
        this.receipts.set(key, receipt);
        return receipt;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Run the configured preflight checks (no-op when disabled). */
  private async preflight(subject: PreflightSubject): Promise<void> {
    if (!this.preflightConfig.enabled) return;
    this.stateReader ??= new SorobanStateReader({
      server: this.server,
      contractId: this.contractId,
      networkPassphrase: this.networkPassphrase,
      sourcePublicKey: this.signer().publicKey(),
    });
    await runChainPreflight(this.stateReader, subject, this.preflightConfig);
  }

  /**
   * Submit with bounded retry on timeouts. Before every attempt after the
   * first, chain state is consulted for the earlier attempts' transaction
   * hashes: if one confirmed, its receipt is returned and nothing is sent
   * again. A contract rejection that means "already done" after a timeout gets
   * the same check, since the earlier attempt may have confirmed in between.
   */
  private async submitWithRetry(
    op: ReturnType<Contract['call']>
  ): Promise<{ txHash: string; ledger: number }> {
    const sent: string[] = [];

    return retryWithBackoff(
      async () => {
        const landed = await this.findLandedTransaction(sent);
        if (landed) return landed;

        try {
          return await this.invokePipeline(op, txHash => {
            sent.push(txHash);
          });
        } catch (err) {
          if (sent.length > 0 && err instanceof AppError && DUPLICATE_CODES.has(err.code)) {
            const confirmed = await this.findLandedTransaction(sent);
            if (confirmed) return confirmed;
          }
          throw err;
        }
      },
      {
        policy: this.retryPolicy,
        sleep: this.sleep,
        onRetry: ({ attempt, delayMs }) => {
          logger.warn(
            { attempt, delayMs, sentTxHashes: sent },
            'Chain submission timed out; retrying after backoff'
          );
        },
      }
    );
  }

  /** First of `txHashes` that confirmed on chain, if any. */
  private async findLandedTransaction(
    txHashes: readonly string[]
  ): Promise<{ txHash: string; ledger: number } | undefined> {
    for (const txHash of txHashes) {
      let ledger: number | null;
      try {
        ledger = await this.getTransactionLedger(txHash);
      } catch (err) {
        // Without an answer, resubmitting could duplicate the event.
        throw new AppError(
          502,
          'Could not verify an earlier submission on chain; not resubmitting',
          ErrorCodes.CHAIN_UNKNOWN,
          { txHash, cause: err instanceof Error ? err.message : String(err) }
        );
      }
      if (ledger !== null) return { txHash, ledger };
    }
    return undefined;
  }

  async confirmDelivery(input: ConfirmDeliveryInput): Promise<ConfirmDeliveryResult> {
    if (!Bytes32HexSchema.safeParse(input.proof_hash).success) {
      throw new AppError(
        422,
        'proof_hash must be 32 bytes of lowercase hex',
        ErrorCodes.CHAIN_INVALID_PROOF
      );
    }

    // Auth precondition: only the receiver (signing key) may confirm delivery.
    // Check before submit so we never waste a transaction on an unauthorized caller.
    const signer = this.signer();
    if (signer.publicKey() !== input.receiver) {
      throw new AppError(
        403,
        'Only the delivery receiver can confirm delivery',
        ErrorCodes.CHAIN_UNAUTHORIZED
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'confirm_delivery',
      new Address(input.receiver).toScVal(),
      nativeToScVal(input.shipment_id, { type: 'symbol' }),
      nativeToScVal(Buffer.from(input.proof_hash, 'hex'), { type: 'bytes' })
    );

    const { txHash, ledger } = await serializeSubmission(this.signer().publicKey(), () =>
      this.invokePipeline(op)
    );
    return {
      txHash,
      ledger,
      simulated: false,
      receiver: input.receiver,
      shipmentId: input.shipment_id,
    };
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

    const { txHash, ledger } = await serializeSubmission(this.signer().publicKey(), () =>
      this.invokePipeline(op, undefined, updateStatusErrorToAppError)
    );
    return {
      txHash,
      ledger,
      simulated: false,
      shipmentId: args.shipment_id,
      newStatus: args.new_status,
    };
  }

  async *streamEvents(cursor?: ChainEventCursor): AsyncIterable<ChainEvent> {
    for await (const event of this.streamEventsWithFailures(cursor)) {
      if (isChainEventDecodeFailure(event)) {
        continue;
      }
      yield event;
    }
  }

  async *streamEventsWithFailures(
    cursor?: ChainEventCursor
  ): AsyncIterable<ChainEvent | ChainEventDecodeFailure> {
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
        } catch (err) {
          yield {
            kind: 'decode_error',
            cursor: typeof rawEvent.id === 'string' ? rawEvent.id : '',
            contract_id:
              typeof rawEvent.contractId === 'string' ? rawEvent.contractId : this.contractId,
            raw_payload: rawEvent,
            candidate_payload: {
              id: rawEvent.id,
              contract_id: rawEvent.contractId,
              tx_hash: rawEvent.txHash,
              ledger: rawEvent.ledger,
              ledger_closed_at: rawEvent.ledgerClosedAt,
              name: rawEvent.topic?.[0],
              topic: rawEvent.topic,
              data: rawEvent.value,
            },
            error: err instanceof Error ? err.message : String(err),
          };
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
    onSent?: (txHash: string) => void,
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

    const resources = simRes.transactionData.build().resources();
    enforceSorobanResourceBudget(
      {
        resourceFee: simRes.minResourceFee,
        cpuInstructions: resources.instructions(),
        ledgerBytes: resources.diskReadBytes() + resources.writeBytes(),
      },
      config.stellarNetwork
    );

    // 2. Assemble
    const assembled = rpc.assembleTransaction(tx, simRes).build();

    // 3. Sign
    assembled.sign(keypair);

    // 4. Send
    const sendRes = await this.server.sendTransaction(assembled);
    if (sendRes.status === 'ERROR') {
      throw new AppError(400, 'Soroban sendTransaction failed', ErrorCodes.CHAIN_UNKNOWN);
    }
    if (sendRes.status === 'TRY_AGAIN_LATER') {
      // Not queued, so there is nothing to look up later; the retry can resend.
      throw new AppError(
        503,
        'Soroban RPC asked to retry the submission later',
        ErrorCodes.CHAIN_SUBMISSION_TIMEOUT
      );
    }

    // 5. Poll
    const txHash = sendRes.hash;
    onSent?.(txHash);
    let statusRes: rpc.Api.GetTransactionResponse;
    const startTime = Date.now();
    const timeoutMs = this.pollTimeoutMs;

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
        throw new AppError(
          504,
          'Soroban transaction polling timed out',
          ErrorCodes.CHAIN_SUBMISSION_TIMEOUT,
          { txHash }
        );
      }
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  // ─── Contract reads (P12-14): simulation only, never submitted ─────────────

  async getShipment(shipmentId: ChainShipmentId): Promise<ChainShipmentRecord | null> {
    const value = await this.simulateRead('get_shipment', [u64(shipmentId)], true);
    return value && decodeShipment(value);
  }

  async getShipmentStatus(shipmentId: ChainShipmentId): Promise<ChainShipmentStatus | null> {
    const value = await this.simulateRead('get_shipment_status', [u64(shipmentId)], true);
    return value && decodeShipmentStatus(value);
  }

  async getEscrowBalance(shipmentId: ChainShipmentId): Promise<bigint | null> {
    const value = await this.simulateRead('get_escrow_balance', [u64(shipmentId)], true);
    return value && decodeI128(value);
  }

  async getVersion(): Promise<number> {
    return decodeU32(await this.simulateRead('get_version', []));
  }

  async getAdmin(): Promise<string> {
    return decodeAddress(await this.simulateRead('get_admin', []));
  }

  async getExpectedTokenDecimals(): Promise<number> {
    return decodeU32(await this.simulateRead('get_expected_token_decimals', []));
  }

  /**
   * Simulate a read-only contract call and return its result ScVal. The
   * transaction is built for the SDK's null account and only simulated, so no
   * signing key, sequence number or fee is involved. With `notFoundAsNull`,
   * a `ShipmentNotFound` contract error resolves to `null`.
   */
  private async simulateRead(method: string, args: xdr.ScVal[]): Promise<xdr.ScVal>;
  private async simulateRead(
    method: string,
    args: xdr.ScVal[],
    notFoundAsNull: true
  ): Promise<xdr.ScVal | null>;
  private async simulateRead(
    method: string,
    args: xdr.ScVal[],
    notFoundAsNull = false
  ): Promise<xdr.ScVal | null> {
    const tx = new TransactionBuilder(new Account(contractClient.NULL_ACCOUNT, '0'), {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.getContract().call(method, ...args))
      .setTimeout(30)
      .build();

    let sim: rpc.Api.SimulateTransactionResponse;
    try {
      sim = await this.server.simulateTransaction(tx);
    } catch (err) {
      throw new AppError(502, `Soroban read ${method} failed`, ErrorCodes.CHAIN_UNKNOWN, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    if (rpc.Api.isSimulationError(sim)) {
      const code = Number(String(sim.error).match(/Error\(Contract, #(\d+)\)/)?.[1]);
      if (notFoundAsNull && code === SHIPMENT_NOT_FOUND) return null;
      throw new AppError(
        502,
        `Soroban read ${method} failed: ${sim.error}`,
        ErrorCodes.CHAIN_UNKNOWN,
        {
          method,
          ...(Number.isInteger(code) ? { contractCode: code } : {}),
        }
      );
    }

    const retval = rpc.Api.isSimulationSuccess(sim) ? sim.result?.retval : undefined;
    if (!retval) {
      throw new AppError(
        502,
        `Soroban read ${method} returned no result`,
        ErrorCodes.CHAIN_UNKNOWN
      );
    }
    return retval;
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

function u64(value: ChainShipmentId): xdr.ScVal {
  return nativeToScVal(value, { type: 'u64' });
}
