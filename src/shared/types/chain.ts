/**
 * Chain interface — typed mirror of docs/chain-interface.md (TODO I2).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ SPEC VERSION: 2.0.0  (see CHAIN_SPEC_VERSION below)                  │
 * │ Mirrors the v2 surface (v1 from P6-01/#649, evolved by #1056/#1058):  │
 * │   functions  anchor · init_escrow · release_escrow (+ authz)         │
 * │              release_escrow = (caller, shipment_id), escrow is       │
 * │              per-shipment — there is no proof_hash argument.         │
 * │   events     anchor · esc_init · esc_rel (topic + data tuples)       │
 * │              every anchored event exposes confirmations + verified   │
 * │   errors     contract error codes → ERR_CHAIN_* backend codes        │
 * │              incl. InvalidStatus and Unauthorized/NotAuthorized      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Rules:
 * - The backend touches chain shapes ONLY through this file. Adapters,
 *   workers and services import types/schemas from here, never redefine them.
 * - Any change to the spec bumps CHAIN_SPEC_VERSION and must land here in the
 *   same PR. Spec ↔ types drift fails the review checklist (AGENTS.md §8).
 * - Field names are snake_case on purpose: they mirror the Soroban contract
 *   ABI and the cross-repo golden fixtures in tests/fixtures/chain/ (TODO L7).
 *   Object key order == positional argument / tuple order in the contract.
 * - Schemas are `.strict()` so an unknown field (i.e. spec drift) is rejected
 *   rather than silently stripped.
 */
import { z } from 'zod';

import { AppError, ErrorCodes } from '../http/errors.js';
import type { ErrorCode } from '../http/errors.js';

export const CHAIN_SPEC_VERSION = '2.1.0' as const;

// ─── Soroban primitives ──────────────────────────────────────────────────────

const I128_MAX = (BigInt(1) << BigInt(127)) - BigInt(1);
const U32_MAX = 0xffffffff;

/** Soroban `Symbol`: up to 32 chars of [a-zA-Z0-9_]. */
export const SymbolSchema = z.string().regex(/^[A-Za-z0-9_]{1,32}$/, 'Invalid Soroban Symbol');

/** `BytesN<32>` as lowercase hex (64 chars) — SHA-256 digests. */
export const Bytes32HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Expected 32 bytes as lowercase hex');

/** Stellar `Address` strkey: account (G…) or contract (C…). */
export const AddressSchema = z
  .string()
  .regex(/^[GC][A-Z2-7]{55}$/, 'Invalid Stellar address strkey');

/** Contract (C…) address — e.g. a Stellar Asset Contract token. */
export const ContractAddressSchema = z
  .string()
  .regex(/^C[A-Z2-7]{55}$/, 'Invalid Stellar contract address');

/** Positive `i128` amount in base units (stroops), as a decimal string. */
export const PositiveI128Schema = z
  .string()
  .regex(/^[1-9][0-9]*$/, 'Expected positive integer string')
  // zod still runs refinements after a failed regex — guard so BigInt() never throws
  .refine(v => !/^[1-9][0-9]*$/.test(v) || BigInt(v) <= I128_MAX, 'Exceeds i128 range');

/** `u32` — ledger sequence numbers. */
export const U32Schema = z.number().int().min(0).max(U32_MAX);

/** `u64` unix-seconds timestamp — contract deadlines. */
export const TimestampSchema = z.number().int().min(0);

/** `u64` on-chain shipment id, as returned by `create_shipment`. */
export const OnChainShipmentIdSchema = z.number().int().min(0);

export const TxHashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Invalid transaction hash');

// ─── Functions ───────────────────────────────────────────────────────────────

/** `anchor(shipment_id: Symbol, data_hash: BytesN<32>, actor: Address)` — auth: `actor`. */
export const AnchorArgsSchema = z
  .object({
    shipment_id: SymbolSchema,
    data_hash: Bytes32HexSchema,
    actor: AddressSchema,
  })
  .strict();

/**
 * `init_escrow(payment_id: Symbol, shipment_id: Symbol, payer: Address,
 *  payee: Address, token: Address, amount: i128)` — auth: `payer`.
 */
export const InitEscrowArgsSchema = z
  .object({
    payment_id: SymbolSchema,
    shipment_id: SymbolSchema,
    payer: AddressSchema,
    payee: AddressSchema,
    token: ContractAddressSchema,
    amount: PositiveI128Schema,
  })
  .strict()
  .refine(a => a.payer !== a.payee, { message: 'payer and payee must differ', path: ['payee'] });

/**
 * `release_escrow(caller: Address, shipment_id: Symbol)` — auth: `caller`.
 *
 * v2 (#1056): the deployed contract releases escrow per shipment and requires
 * the caller to authorize. The v1 `(payment_id, proof_hash)` shape was never a
 * real contract argument — `proof_hash` was a backend-invented value — so it
 * is removed rather than kept as a deprecated alias.
 */
export const ReleaseEscrowArgsSchema = z
  .object({
    caller: AddressSchema,
    shipment_id: SymbolSchema,
  })
  .strict();

/**
 * `create_shipment(sender: Address, receiver: Address, carrier: Address,
 *  data_hash: BytesN<32>, payment_milestones: Vec<i128>, deadline: u64) -> u64`
 * — auth: `sender` (#1037).
 */
export const PaymentMilestonesSchema = z.array(PositiveI128Schema).min(1);

export const CreateShipmentArgsSchema = z
  .object({
    sender: AddressSchema,
    receiver: AddressSchema,
    carrier: AddressSchema,
    data_hash: Bytes32HexSchema,
    payment_milestones: PaymentMilestonesSchema,
    deadline: TimestampSchema,
  })
  .strict()
  .refine(a => new Set([a.sender, a.receiver, a.carrier]).size === 3, {
    message: 'sender, receiver and carrier must be distinct participants',
    path: ['carrier'],
  });

/** `raise_dispute(caller: Address, shipment_id: Symbol, reason_hash: BytesN<32>)` — auth: `caller` (#1036). */
export const RaiseDisputeArgsSchema = z
  .object({
    caller: AddressSchema,
    shipment_id: SymbolSchema,
    reason_hash: Bytes32HexSchema,
  })
  .strict();

/** Dispute resolution outcome, set authoritatively by the contract (#1036). */
export const DisputeOutcomeSchema = z.enum(['resolved', 'rejected']);
export type DisputeOutcome = z.infer<typeof DisputeOutcomeSchema>;

/** `resolve_dispute(admin: Address, shipment_id: Symbol, outcome: Symbol)` — auth: `admin` (#1036). */
export const ResolveDisputeArgsSchema = z
  .object({
    admin: AddressSchema,
    shipment_id: SymbolSchema,
    outcome: DisputeOutcomeSchema,
  })
  .strict();

/** `add_company(admin: Address, company: Address)` — auth: `admin` (#1042). */
export const AddCompanyArgsSchema = z
  .object({
    admin: AddressSchema,
    company: AddressSchema,
  })
  .strict();

/** `add_carrier(admin: Address, company: Address, carrier: Address)` — auth: `admin` (#1042). */
export const AddCarrierArgsSchema = z
  .object({
    admin: AddressSchema,
    company: AddressSchema,
    carrier: AddressSchema,
  })
  .strict();

/**
 * `add_carrier_to_whitelist(admin: Address, company: Address, carrier: Address)`
 * — auth: `admin` (#1042). Distinct from `add_carrier`: this scopes an already-registered
 * carrier to one company's per-company whitelist.
 */
export const AddCarrierToWhitelistArgsSchema = z
  .object({
    admin: AddressSchema,
    company: AddressSchema,
    carrier: AddressSchema,
  })
  .strict();

/** Result of any confirmed state-changing invocation. */
export const ChainTxResultSchema = z
  .object({
    tx_hash: TxHashSchema,
    ledger: U32Schema,
  })
  .strict();

/** Result of `create_shipment` — the tx receipt plus the returned on-chain `u64` id. */
export const CreateShipmentResultSchema = ChainTxResultSchema.extend({
  shipment_id: OnChainShipmentIdSchema,
}).strict();

export const CHAIN_FUNCTIONS = [
  'anchor',
  'init_escrow',
  'release_escrow',
  'create_shipment',
  'raise_dispute',
  'resolve_dispute',
  'add_company',
  'add_carrier',
  'add_carrier_to_whitelist',
] as const;
export type ChainFunctionName = (typeof CHAIN_FUNCTIONS)[number];

/** Who must `require_auth()` for each function, per spec. */
export const CHAIN_FUNCTION_AUTH: Readonly<
  Record<ChainFunctionName, 'actor' | 'payer' | 'caller' | 'admin' | 'sender'>
> = {
  anchor: 'actor',
  init_escrow: 'payer',
  release_escrow: 'caller',
  create_shipment: 'sender',
  raise_dispute: 'caller',
  resolve_dispute: 'admin',
  add_company: 'admin',
  add_carrier: 'admin',
  add_carrier_to_whitelist: 'admin',
};

export const ChainFunctionArgsSchemas = {
  anchor: AnchorArgsSchema,
  init_escrow: InitEscrowArgsSchema,
  release_escrow: ReleaseEscrowArgsSchema,
  create_shipment: CreateShipmentArgsSchema,
  raise_dispute: RaiseDisputeArgsSchema,
  resolve_dispute: ResolveDisputeArgsSchema,
  add_company: AddCompanyArgsSchema,
  add_carrier: AddCarrierArgsSchema,
  add_carrier_to_whitelist: AddCarrierToWhitelistArgsSchema,
} as const satisfies Record<ChainFunctionName, z.ZodTypeAny>;

export type AnchorArgs = z.infer<typeof AnchorArgsSchema>;
export type InitEscrowArgs = z.infer<typeof InitEscrowArgsSchema>;
export type ReleaseEscrowArgs = z.infer<typeof ReleaseEscrowArgsSchema>;
export type CreateShipmentArgs = z.infer<typeof CreateShipmentArgsSchema>;
export type RaiseDisputeArgs = z.infer<typeof RaiseDisputeArgsSchema>;
export type ResolveDisputeArgs = z.infer<typeof ResolveDisputeArgsSchema>;
export type AddCompanyArgs = z.infer<typeof AddCompanyArgsSchema>;
export type AddCarrierArgs = z.infer<typeof AddCarrierArgsSchema>;
export type AddCarrierToWhitelistArgs = z.infer<typeof AddCarrierToWhitelistArgsSchema>;
export type ChainTxResult = z.infer<typeof ChainTxResultSchema>;
export type CreateShipmentResult = z.infer<typeof CreateShipmentResultSchema>;

// ─── Events ──────────────────────────────────────────────────────────────────

export const CHAIN_EVENT_NAMES = {
  ANCHOR: 'anchor',
  ESCROW_INIT: 'esc_init',
  ESCROW_RELEASE: 'esc_rel',
  DISPUTE_RAISED: 'dispute_raised',
  DISPUTE_RESOLVED: 'dispute_resolved',
} as const;
export type ChainEventName = (typeof CHAIN_EVENT_NAMES)[keyof typeof CHAIN_EVENT_NAMES];

/** Envelope fields common to every decoded contract event. */
const eventEnvelope = {
  /** RPC event id — stable paging cursor, used for idempotent indexing. */
  id: z.string().min(1),
  contract_id: ContractAddressSchema,
  tx_hash: TxHashSchema,
  ledger: U32Schema,
  ledger_closed_at: z.string().datetime(),
};

/** topic `["anchor", shipment_id]` · data `(data_hash, ledger)` */
export const AnchorEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ANCHOR),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ANCHOR), SymbolSchema]),
    data: z.tuple([Bytes32HexSchema, U32Schema]),
  })
  .strict();

/** topic `["esc_init", payment_id]` · data `(shipment_id, payer, payee, token, amount)` */
export const EscrowInitEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ESCROW_INIT),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ESCROW_INIT), SymbolSchema]),
    data: z.tuple([
      SymbolSchema,
      AddressSchema,
      AddressSchema,
      ContractAddressSchema,
      PositiveI128Schema,
    ]),
  })
  .strict();

/** topic `["esc_rel", payment_id]` · data `(proof_hash, payee, amount)` */
export const EscrowReleaseEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ESCROW_RELEASE),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ESCROW_RELEASE), SymbolSchema]),
    data: z.tuple([Bytes32HexSchema, AddressSchema, PositiveI128Schema]),
  })
  .strict();

/** topic `["dispute_raised", shipment_id]` · data `(reason_hash, caller)` (#1036) */
export const DisputeRaisedEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.DISPUTE_RAISED),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.DISPUTE_RAISED), SymbolSchema]),
    data: z.tuple([Bytes32HexSchema, AddressSchema]),
  })
  .strict();

/** topic `["dispute_resolved", shipment_id]` · data `(outcome, caller)` (#1036) */
export const DisputeResolvedEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.DISPUTE_RESOLVED),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.DISPUTE_RESOLVED), SymbolSchema]),
    data: z.tuple([DisputeOutcomeSchema, AddressSchema]),
  })
  .strict();

/** Runtime validator for the indexer and golden fixtures. */
export const ChainEventSchema = z.discriminatedUnion('name', [
  AnchorEventSchema,
  EscrowInitEventSchema,
  EscrowReleaseEventSchema,
  DisputeRaisedEventSchema,
  DisputeResolvedEventSchema,
]);

export type AnchorEvent = z.infer<typeof AnchorEventSchema>;
export type EscrowInitEvent = z.infer<typeof EscrowInitEventSchema>;
export type EscrowReleaseEvent = z.infer<typeof EscrowReleaseEventSchema>;
export type DisputeRaisedEvent = z.infer<typeof DisputeRaisedEventSchema>;
export type DisputeResolvedEvent = z.infer<typeof DisputeResolvedEventSchema>;
export type ChainEvent = z.infer<typeof ChainEventSchema>;

// ─── Event verification / confirmation depth (v2, #1058) ────────────────────

/** Default ledgers required before an anchored record is treated as `verified`. */
export const DEFAULT_CONFIRMATION_THRESHOLD = 3;

/** Confirmation metadata exposed consistently for every anchored event class. */
export const ChainEventVerificationSchema = z
  .object({
    confirmations: U32Schema,
    verified: z.boolean(),
  })
  .strict();
export type ChainEventVerification = z.infer<typeof ChainEventVerificationSchema>;

/**
 * Ledgers closed strictly after `ledger`: 0 at the head, N once N more ledgers
 * have closed. Pure so fixture tests can exercise any depth deterministically.
 */
export function confirmationDepth(ledger: number, headLedger: number): number {
  return Math.max(0, headLedger - ledger);
}

/**
 * Idempotent verification decision shared by anchors, status updates,
 * milestones and escrow events. Re-running with a higher head is safe.
 */
export function verifyAnchoredLedger(
  ledger: number,
  headLedger: number,
  threshold: number = DEFAULT_CONFIRMATION_THRESHOLD
): ChainEventVerification {
  const confirmations = confirmationDepth(ledger, headLedger);
  return { confirmations, verified: confirmations >= threshold };
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** `#[contracterror]` u32 discriminants emitted by the contract. */
export const CHAIN_CONTRACT_ERRORS = {
  NotAuthorized: 1,
  InvalidHash: 2,
  AlreadyAnchored: 3,
  EscrowExists: 4,
  EscrowNotFound: 5,
  EscrowAlreadyReleased: 6,
  InvalidAmount: 7,
  InvalidProof: 8,
  /** v2 (#1056): escrow release attempted from a shipment in the wrong state. */
  InvalidStatus: 9,
  // #1035 — real failure classes for the v2.1 surface (RBAC, shipments, disputes).
  /** Caller lacks the required company/carrier role or whitelist entry. */
  RoleDenied: 10,
  /** No shipment exists for the given on-chain id. */
  ShipmentNotFound: 11,
  /** Dispute/shipment action attempted from the wrong state. */
  InvalidTransition: 12,
  /** Escrow is frozen (e.g. by an open dispute). */
  EscrowLocked: 13,
  /** Escrow balance cannot cover the requested action. */
  InsufficientFunds: 14,
  /** Contract is paused by an emergency admin switch. */
  ContractPaused: 15,
  /** Action was already performed (idempotent reject). */
  DuplicateAction: 16,
  /** Underlying token transfer/mint failed. */
  TokenTransferFailed: 17,
  /** Caller exceeded the contract's rate limit. */
  RateLimited: 18,
  /** Contract's circuit breaker tripped. */
  CircuitBreakerOpen: 19,
  /** Shipment already reached a terminal state. */
  ShipmentFinalized: 20,
} as const;
export type ChainContractErrorName = keyof typeof CHAIN_CONTRACT_ERRORS;
export type ChainContractErrorCode = (typeof CHAIN_CONTRACT_ERRORS)[ChainContractErrorName];

/** Decoded contract error (from a failed simulation / transaction result). */
export const ChainContractErrorSchema = z
  .object({
    code: z.nativeEnum(CHAIN_CONTRACT_ERRORS),
    function: z.enum(CHAIN_FUNCTIONS),
  })
  .strict();
export type ChainContractError = z.infer<typeof ChainContractErrorSchema>;

/** Spec error taxonomy: contract error → backend `ERR_CHAIN_*` code + HTTP status. */
export const CHAIN_ERROR_MAP: Readonly<
  Record<ChainContractErrorName, { code: ErrorCode; status: number }>
> = {
  NotAuthorized: { code: ErrorCodes.CHAIN_UNAUTHORIZED, status: 403 },
  InvalidHash: { code: ErrorCodes.CHAIN_INVALID_HASH, status: 422 },
  AlreadyAnchored: { code: ErrorCodes.CHAIN_ALREADY_ANCHORED, status: 409 },
  EscrowExists: { code: ErrorCodes.CHAIN_ESCROW_EXISTS, status: 409 },
  EscrowNotFound: { code: ErrorCodes.CHAIN_ESCROW_NOT_FOUND, status: 404 },
  EscrowAlreadyReleased: { code: ErrorCodes.CHAIN_ESCROW_ALREADY_RELEASED, status: 409 },
  InvalidAmount: { code: ErrorCodes.CHAIN_INVALID_AMOUNT, status: 422 },
  InvalidProof: { code: ErrorCodes.CHAIN_INVALID_PROOF, status: 422 },
  InvalidStatus: { code: ErrorCodes.CHAIN_INVALID_STATUS, status: 409 },
  RoleDenied: { code: ErrorCodes.CHAIN_ROLE_DENIED, status: 403 },
  ShipmentNotFound: { code: ErrorCodes.CHAIN_SHIPMENT_NOT_FOUND, status: 404 },
  InvalidTransition: { code: ErrorCodes.CHAIN_INVALID_TRANSITION, status: 409 },
  EscrowLocked: { code: ErrorCodes.CHAIN_ESCROW_LOCKED, status: 409 },
  InsufficientFunds: { code: ErrorCodes.CHAIN_INSUFFICIENT_FUNDS, status: 422 },
  ContractPaused: { code: ErrorCodes.CHAIN_CONTRACT_PAUSED, status: 503 },
  DuplicateAction: { code: ErrorCodes.CHAIN_DUPLICATE_ACTION, status: 409 },
  TokenTransferFailed: { code: ErrorCodes.CHAIN_TOKEN_TRANSFER_FAILED, status: 502 },
  RateLimited: { code: ErrorCodes.CHAIN_RATE_LIMITED, status: 429 },
  CircuitBreakerOpen: { code: ErrorCodes.CHAIN_CIRCUIT_BREAKER_OPEN, status: 503 },
  ShipmentFinalized: { code: ErrorCodes.CHAIN_SHIPMENT_FINALIZED, status: 409 },
};

const errorNameByCode = new Map<number, ChainContractErrorName>(
  (Object.entries(CHAIN_CONTRACT_ERRORS) as [ChainContractErrorName, number][]).map(([n, c]) => [
    c,
    n,
  ])
);

/**
 * Translate a raw contract error discriminant into an AppError.
 * Codes outside the spec map to ERR_CHAIN_UNKNOWN (502) — a signal of drift.
 */
export function chainErrorToAppError(contractCode: number): AppError {
  const name = errorNameByCode.get(contractCode);
  if (!name) {
    return new AppError(
      502,
      `Unknown chain contract error ${contractCode} (spec ${CHAIN_SPEC_VERSION})`,
      ErrorCodes.CHAIN_UNKNOWN,
      { contractCode }
    );
  }
  const { code, status } = CHAIN_ERROR_MAP[name];
  return new AppError(status, `Chain contract error: ${name}`, code, { contractCode });
}

/**
 * Validate an untrusted decoded event (indexer ingress).
 * Throws AppError(502, ERR_CHAIN_INVALID_EVENT) on any spec mismatch.
 */
export function parseChainEvent(raw: unknown): ChainEvent {
  const result = ChainEventSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      502,
      `Chain event does not match spec ${CHAIN_SPEC_VERSION}`,
      ErrorCodes.CHAIN_INVALID_EVENT,
      result.error.issues
    );
  }
  return result.data;
}
