/**
 * SimulatedAdapter (TODO J2 · P6-04) — today's Horizon manage-data flows behind
 * the ChainAdapter port while the Soroban adapter is built.
 *
 * NOTHING here touches a contract or moves funds: every result carries
 * `simulated: true` so API consumers and demos never imply real escrow.
 *
 * Mapping (legacy stellar.service.ts → port):
 * - anchorTelemetryHash → anchorEvent: manage-data `telemetry:<shipment_id>` = data_hash, hash memo
 * - tokenizeShipment    → anchorEvent: hash of the tokenized shipment fields
 * - releaseEscrow       → releaseEscrow (v2): manage-data `release:<shipment_id>` holds a
 *   deterministic digest of `(caller, shipment_id)` with a matching hash memo. Escrow is
 *   per-shipment; the v1 payment_id/proof_hash pair is gone. Failures reject with AppError
 *   (ERR_CHAIN_*) instead of resolving `{ success: false }`.
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
  AddCarrierArgsSchema,
  AddCarrierToWhitelistArgsSchema,
  AddCompanyArgsSchema,
  AddressSchema,
  Bytes32HexSchema,
  CHAIN_EVENT_NAMES,
  CreateShipmentArgsSchema,
  RaiseDisputeArgsSchema,
  ResolveDisputeArgsSchema,
  SymbolSchema,
  parseChainEvent,
} from '../../shared/types/chain.js';
import type { ChainEvent } from '../../shared/types/chain.js';
import { generateDataHash } from '../../shared/utils/crypto.js';
import { KeyedSerializer } from './serializer.js';
import type {
  AddCarrierInput,
  AddCarrierToWhitelistInput,
  AddCompanyInput,
  AnchorEventInput,
  AnchorResult,
  ChainAdapter,
  ChainErrorCode,
  ChainEventCursor,
  ChainTxReceipt,
  CreateShipmentInput,
  CreateShipmentResult,
  EscrowResult,
  RaiseDisputeInput,
  ReleaseEscrowInput,
  ResolveDisputeInput,
  RoleProvisionAction,
  RolePreflightResult,
  RoleProvisionResult,
} from './types.js';

/** Sentinel contract id for simulated events (all-zero contract strkey) — no contract exists. */
const SIMULATED_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));

const ANCHOR_KEY_PREFIX = 'telemetry:';
const RELEASE_KEY_PREFIX = 'release:';
const SHIPMENT_KEY_PREFIX = 'shipment:';
const DISPUTE_KEY_PREFIX = 'dispute:';
const RESOLVE_KEY_PREFIX = 'resolve:';
const ROLE_KEY_PREFIX = 'role:';
const PAGE_SIZE = 200;
const MAX_BAD_SEQ_RETRIES = 2;

/** Process-wide: every adapter instance signing for an account shares its queue. */
const accountSerializer = new KeyedSerializer();

/** Horizon rejects a stale sequence with `tx_bad_seq`. */
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

/** Fast local-validation failure before a submission — the contract stays authoritative. */
function chainValidationError(error: { message: string }, code: ChainErrorCode) {
  return chainError(422, `Invalid arguments: ${error.message}`, code);
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
    if (!AddressSchema.safeParse(input.caller).success) {
      throw chainError(
        422,
        'caller must be a valid Stellar address strkey',
        ErrorCodes.CHAIN_UNAUTHORIZED
      );
    }
    if (!SymbolSchema.safeParse(input.shipment_id).success) {
      throw chainError(422, 'shipment_id must be a valid Soroban Symbol', ErrorCodes.CHAIN_UNKNOWN);
    }

    const releaseDigest = generateDataHash({
      caller: input.caller,
      shipment_id: input.shipment_id,
    });
    const { hash, ledger } = await this.submitManageData(
      `${RELEASE_KEY_PREFIX}${input.shipment_id}`,
      releaseDigest
    );
    return { txHash: hash, ledger, simulated: true, shipmentId: input.shipment_id };
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const parsed = CreateShipmentArgsSchema.safeParse(input);
    if (!parsed.success) throw chainValidationError(parsed.error, ErrorCodes.CHAIN_INVALID_AMOUNT);

    const digest = generateDataHash(input);
    const { hash, ledger } = await this.submitManageData(
      `${SHIPMENT_KEY_PREFIX}${digest.slice(0, 32)}`,
      digest
    );
    // Simulated mode has no real ledger-assigned id; the confirming ledger is
    // a stable, monotonically increasing stand-in — never used by SorobanAdapter.
    return { txHash: hash, ledger, simulated: true, shipmentId: ledger };
  }

  async raiseDispute(input: RaiseDisputeInput): Promise<ChainTxReceipt> {
    const parsed = RaiseDisputeArgsSchema.safeParse(input);
    if (!parsed.success) throw chainValidationError(parsed.error, ErrorCodes.CHAIN_INVALID_HASH);

    const { hash, ledger } = await this.submitManageData(
      `${DISPUTE_KEY_PREFIX}${input.shipment_id}`,
      input.reason_hash
    );
    return { txHash: hash, ledger, simulated: true };
  }

  async resolveDispute(input: ResolveDisputeInput): Promise<ChainTxReceipt> {
    const parsed = ResolveDisputeArgsSchema.safeParse(input);
    if (!parsed.success) throw chainValidationError(parsed.error, ErrorCodes.CHAIN_UNKNOWN);

    const digest = generateDataHash({ shipment_id: input.shipment_id, outcome: input.outcome });
    const { hash, ledger } = await this.submitManageData(
      `${RESOLVE_KEY_PREFIX}${input.shipment_id}`,
      digest
    );
    return { txHash: hash, ledger, simulated: true };
  }

  async addCompany(input: AddCompanyInput): Promise<RoleProvisionResult> {
    const parsed = AddCompanyArgsSchema.safeParse(input);
    if (!parsed.success) throw chainValidationError(parsed.error, ErrorCodes.CHAIN_ROLE_DENIED);
    return this.submitRoleAction('add_company', input.company, input);
  }

  async addCarrier(input: AddCarrierInput): Promise<RoleProvisionResult> {
    const parsed = AddCarrierArgsSchema.safeParse(input);
    if (!parsed.success) throw chainValidationError(parsed.error, ErrorCodes.CHAIN_ROLE_DENIED);
    return this.submitRoleAction('add_carrier', `${input.company}:${input.carrier}`, input);
  }

  async addCarrierToWhitelist(input: AddCarrierToWhitelistInput): Promise<RoleProvisionResult> {
    const parsed = AddCarrierToWhitelistArgsSchema.safeParse(input);
    if (!parsed.success) throw chainValidationError(parsed.error, ErrorCodes.CHAIN_ROLE_DENIED);
    return this.submitRoleAction(
      'add_carrier_to_whitelist',
      `${input.company}:${input.carrier}`,
      input
    );
  }

  /** No role/whitelist state exists in simulated mode — nothing to deny. */
  async preflightRole(
    _action: RoleProvisionAction,
    _input: AddCompanyInput | AddCarrierInput | AddCarrierToWhitelistInput
  ): Promise<RolePreflightResult> {
    return { allowed: true };
  }

  private async submitRoleAction(
    action: string,
    key: string,
    payload: unknown
  ): Promise<RoleProvisionResult> {
    const digest = generateDataHash(payload as Record<string, unknown>);
    const { hash, ledger } = await this.submitManageData(
      `${ROLE_KEY_PREFIX}${action}:${key}`,
      digest
    );
    return { txHash: hash, ledger, simulated: true };
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

  async getConfirmationCount(_ledger: number): Promise<number> {
    return 3;
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
      throw chainError(502, 'Simulated chain (Horizon) request failed', ErrorCodes.CHAIN_UNKNOWN);
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
