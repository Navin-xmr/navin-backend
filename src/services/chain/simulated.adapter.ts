/**
 * SimulatedAdapter (TODO J2 · P6-04) — today's Horizon manage-data flows behind
 * the ChainAdapter port while the Soroban adapter is built.
 *
 * NOTHING here touches a contract or moves funds: every result carries
 * `simulated: true` so API consumers and demos never imply real escrow.
 *
 * Mapping (legacy stellar.service.ts → port):
 * - anchorTelemetryHash → anchorEvent: manage-data `telemetry:<shipment_id>` = data_hash, hash memo
 * - tokenizeShipment    → anchorEvent: tokenized fields anchored as a SHA-256 hash (hash-and-emit)
 * - releaseEscrow       → releaseEscrow: manage-data `release:<payment_id>` = proof_hash, hash memo.
 *   (The legacy `Memo.text('escrow-release:<id>')` exceeds Stellar's 28-byte text-memo limit for
 *   ObjectId payment ids, so it is not reproduced here.) Failures reject with AppError instead of
 *   resolving `{ success: false }`.
 * - streamEvents: replays anchor manage-data writes from the signer account's Horizon history as
 *   spec `anchor` events. Release writes are not streamed — manage-data never recorded the payee
 *   or amount that a spec `esc_rel` event requires, and fabricating them would be dishonest.
 *   The stream ends at the current head; re-invoke with the last event id to continue.
 *
 * Signing safety (TODO J4): submissions are serialized per source account in-process, and a
 * `tx_bad_seq` caused by another process sharing the account is retried with a fresh sequence.
 * Obtain instances via getChainAdapter() in ./factory.ts — never construct in domain code.
 */
import {
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import type { Account, Transaction } from '@stellar/stellar-sdk';

import { config } from '../../config/index.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import {
  Bytes32HexSchema,
  CHAIN_EVENT_NAMES,
  SymbolSchema,
  parseChainEvent,
} from '../../shared/types/chain.js';
import type { ChainEvent } from '../../shared/types/chain.js';

import { KeyedSerializer } from './serializer.js';
import type {
  AnchorEventInput,
  AnchorResult,
  ChainAdapter,
  ChainErrorCode,
  ChainEventCursor,
  EscrowResult,
  ReleaseEscrowInput,
} from './types.js';

/** Sentinel contract id for simulated events (all-zero contract strkey) — no contract exists. */
const SIMULATED_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));

const ANCHOR_KEY_PREFIX = 'telemetry:';
const RELEASE_KEY_PREFIX = 'release:';
const PAGE_SIZE = 200;
const MAX_BAD_SEQ_RETRIES = 2;

/** Process-wide: every adapter instance signing for an account shares its queue. */
const accountSerializer = new KeyedSerializer();

/**
 * Module-private Horizon plumbing (#814): nothing below is exported — only
 * `SimulatedAdapter` leaves this file. Domain modules must depend on the port
 * (./types.ts) via getChainAdapter(); the chain.* suites inject their own fake
 * Horizon instead of importing these internals.
 *
 * isBadSequence: Horizon rejects a stale sequence with
 * `extras.result_codes.transaction === 'tx_bad_seq'`.
 */
function isBadSequence(err: unknown): boolean {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data as
    { extras?: { result_codes?: { transaction?: string } } } | undefined;
  return data?.extras?.result_codes?.transaction === 'tx_bad_seq';
}

/** Horizon transaction record fields the adapter reads. */
interface HorizonTxRecord {
  paging_token: string;
  hash: string;
  ledger_attr: number;
  created_at: string;
  envelope_xdr: string;
  successful: boolean;
}

/** Narrow Horizon surface — injectable for tests. */
interface HorizonClient {
  loadAccount(publicKey: string): Promise<Account>;
  submitTransaction(tx: Transaction): Promise<{ hash: string; ledger: number }>;
  /** Ascending, successful-only transactions for `publicKey`, strictly after `cursor`. */
  listTransactions(
    publicKey: string,
    cursor: string | undefined,
    limit: number
  ): Promise<HorizonTxRecord[]>;
}

interface SimulatedAdapterOptions {
  horizon?: HorizonClient;
  secretKey?: string;
  networkPassphrase?: string;
}

function createHorizonClient(horizonUrl: string = config.horizonUrl): HorizonClient {
  const server = new Horizon.Server(horizonUrl);
  return {
    loadAccount: publicKey => server.loadAccount(publicKey),
    submitTransaction: tx => server.submitTransaction(tx),
    async listTransactions(publicKey, cursor, limit) {
      let query = server.transactions().forAccount(publicKey).order('asc').limit(limit);
      if (cursor) query = query.cursor(cursor);
      const page = await query.call();
      return page.records;
    },
  };
}

function chainError(status: number, message: string, code: ChainErrorCode, details?: unknown) {
  return new AppError(status, message, code, details);
}

function assertBytes32(value: string, field: string, code: ChainErrorCode): void {
  if (!Bytes32HexSchema.safeParse(value).success) {
    throw chainError(422, `${field} must be 32 bytes of lowercase hex`, code);
  }
}

export class SimulatedAdapter implements ChainAdapter {
  private readonly horizon: HorizonClient;
  private readonly secretKey: string | undefined;
  private readonly networkPassphrase: string;

  constructor(options: SimulatedAdapterOptions = {}) {
    this.horizon = options.horizon ?? createHorizonClient();
    this.secretKey = options.secretKey ?? config.stellarSecretKey;
    this.networkPassphrase =
      options.networkPassphrase ??
      (config.stellarNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET);
  }

  async anchorEvent(input: AnchorEventInput): Promise<AnchorResult> {
    assertBytes32(input.data_hash, 'data_hash', ErrorCodes.CHAIN_INVALID_HASH);
    const { hash, ledger } = await this.submitManageData(
      `${ANCHOR_KEY_PREFIX}${input.shipment_id}`,
      input.data_hash
    );
    return { txHash: hash, ledger, simulated: true };
  }

  async releaseEscrow(input: ReleaseEscrowInput): Promise<EscrowResult> {
    assertBytes32(input.proof_hash, 'proof_hash', ErrorCodes.CHAIN_INVALID_PROOF);
    const { hash, ledger } = await this.submitManageData(
      `${RELEASE_KEY_PREFIX}${input.payment_id}`,
      input.proof_hash
    );
    return { txHash: hash, ledger, simulated: true, paymentId: input.payment_id };
  }

  async *streamEvents(cursor?: ChainEventCursor): AsyncIterable<ChainEvent> {
    const publicKey = this.signer().publicKey();
    let position = cursor;

    for (;;) {
      const records = await this.wrap(() =>
        this.horizon.listTransactions(publicKey, position, PAGE_SIZE)
      );
      for (const record of records) {
        position = record.paging_token;
        const event = this.toAnchorEvent(record);
        if (event) yield event;
      }
      if (records.length < PAGE_SIZE) return;
    }
  }

  private signer(): Keypair {
    if (!this.secretKey) {
      throw chainError(500, 'STELLAR_SECRET_KEY is not configured', ErrorCodes.CHAIN_UNKNOWN);
    }
    return Keypair.fromSecret(this.secretKey);
  }

  /** Same shape as the legacy flows: one manage-data op, hash memo, 30s timeout. */
  private async submitManageData(name: string, hexValue: string) {
    const keypair = this.signer();
    const publicKey = keypair.publicKey();

    // Signing safety (TODO J4): one in-flight load→build→sign→submit per source
    // account, so concurrent jobs never build against the same sequence number.
    return this.wrap(() =>
      accountSerializer.run(publicKey, async () => {
        for (let attempt = 0; ; attempt++) {
          const account = await this.horizon.loadAccount(publicKey);
          const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: this.networkPassphrase,
          })
            .addOperation(Operation.manageData({ name, value: hexValue }))
            .addMemo(Memo.hash(Buffer.from(hexValue, 'hex')))
            .setTimeout(30)
            .build();
          tx.sign(keypair);
          try {
            const { hash, ledger } = await this.horizon.submitTransaction(tx);
            return { hash, ledger };
          } catch (err) {
            // Another process sharing this account advanced the sequence: reload and rebuild.
            if (isBadSequence(err) && attempt < MAX_BAD_SEQ_RETRIES) continue;
            throw err;
          }
        }
      })
    );
  }

  /** Port error contract: every rejection is an AppError with an ERR_CHAIN_* code. */
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError && err.code.startsWith('ERR_CHAIN_')) throw err;
      throw chainError(502, 'Simulated chain (Horizon) request failed', ErrorCodes.CHAIN_UNKNOWN, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private toAnchorEvent(record: HorizonTxRecord): ChainEvent | null {
    if (!record.successful) return null;

    let decoded: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      decoded = TransactionBuilder.fromXDR(record.envelope_xdr, this.networkPassphrase);
    } catch {
      return null;
    }
    const tx = 'innerTransaction' in decoded ? decoded.innerTransaction : decoded;

    for (const op of tx.operations) {
      if (op.type !== 'manageData' || !op.name.startsWith(ANCHOR_KEY_PREFIX)) continue;
      const shipmentId = op.name.slice(ANCHOR_KEY_PREFIX.length);
      const dataHash = op.value?.toString('utf8') ?? '';
      if (!SymbolSchema.safeParse(shipmentId).success) continue;
      if (!Bytes32HexSchema.safeParse(dataHash).success) continue;

      return parseChainEvent({
        id: record.paging_token,
        contract_id: SIMULATED_CONTRACT_ID,
        tx_hash: record.hash,
        ledger: record.ledger_attr,
        ledger_closed_at: record.created_at,
        name: CHAIN_EVENT_NAMES.ANCHOR,
        topic: [CHAIN_EVENT_NAMES.ANCHOR, shipmentId],
        data: [dataHash, record.ledger_attr],
      });
    }
    return null;
  }
}
