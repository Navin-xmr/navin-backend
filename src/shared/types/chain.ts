/**
 * Chain interface — typed mirror of docs/chain-interface.md (TODO I2).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ SPEC VERSION: 2.1.0  (see CHAIN_SPEC_VERSION below)                  │
 * │ Mirrors the v2 surface (v1 from P6-01/#649, evolved by #1056/#1058):  │
 * │   functions  anchor · init_escrow · release_escrow (+ authz)         │
 * │              update_status (v2.1, #1047 — real contract ABI)         │
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
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

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

/** `confirm_delivery(receiver: Address, shipment_id: Symbol, proof_hash: BytesN<32>)` — auth: `receiver`. */
export const ConfirmDeliveryArgsSchema = z
  .object({
    receiver: AddressSchema,
    shipment_id: SymbolSchema,
    proof_hash: Bytes32HexSchema,
  })
  .strict();

/**
 * `ShipmentStatus` contract enum, in the EXACT declaration order of
 * Navin-xmr/navin-contracts `contracts/shipment/src/types.rs`. The variant name
 * is the on-chain identity: a `#[contracttype]` unit-variant enum is encoded as
 * the ScVal vec `[Symbol(<VariantName>)]`. Reordering/renaming is an ABI break.
 */
export const SHIPMENT_STATUSES = [
  'Created',
  'InTransit',
  'AtCheckpoint',
  'PartiallyDelivered',
  'Delivered',
  'Disputed',
  'Cancelled',
  'PartiallyRefunded',
] as const;
export type ShipmentStatusName = (typeof SHIPMENT_STATUSES)[number];
export const ShipmentStatusSchema = z.enum(SHIPMENT_STATUSES);

/** `u64` as an unsigned decimal string (no leading zeros) — the contract's shipment id type. */
export const U64StringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'Expected unsigned integer string')
  .refine(v => !/^(0|[1-9][0-9]*)$/.test(v) || BigInt(v) <= U64_MAX, 'Exceeds u64 range');

/**
 * `update_status(caller: Address, shipment_id: u64, new_status: ShipmentStatus,
 *  data_hash: BytesN<32>)` — auth: `caller` (shipment carrier or admin).
 *
 * `data_hash` is computed by the backend over the canonical status payload and
 * passed through untouched by adapters. NOTE: unlike the legacy functions above,
 * the contract's `shipment_id` here is a `u64`, not a `Symbol`.
 */
export const UpdateStatusArgsSchema = z
  .object({
    caller: AddressSchema,
    shipment_id: U64StringSchema,
    new_status: ShipmentStatusSchema,
    data_hash: Bytes32HexSchema,
  })
  .strict();

/** Result of any confirmed state-changing invocation. */
export const ChainTxResultSchema = z
  .object({
    tx_hash: TxHashSchema,
    ledger: U32Schema,
  })
  .strict();

export const CHAIN_FUNCTIONS = [
  'anchor',
  'init_escrow',
  'release_escrow',
  'confirm_delivery',
  'update_status',
] as const;
export type ChainFunctionName = (typeof CHAIN_FUNCTIONS)[number];

/** Who must `require_auth()` for each function, per spec. */
export const CHAIN_FUNCTION_AUTH: Readonly<
  Record<ChainFunctionName, 'actor' | 'payer' | 'caller' | 'admin' | 'receiver'>
> = {
  anchor: 'actor',
  init_escrow: 'payer',
  release_escrow: 'caller',
  confirm_delivery: 'receiver',
  update_status: 'caller',
};

export const ChainFunctionArgsSchemas = {
  anchor: AnchorArgsSchema,
  init_escrow: InitEscrowArgsSchema,
  release_escrow: ReleaseEscrowArgsSchema,
  confirm_delivery: ConfirmDeliveryArgsSchema,
  update_status: UpdateStatusArgsSchema,
} as const satisfies Record<ChainFunctionName, z.ZodTypeAny>;

export type AnchorArgs = z.infer<typeof AnchorArgsSchema>;
export type InitEscrowArgs = z.infer<typeof InitEscrowArgsSchema>;
export type ReleaseEscrowArgs = z.infer<typeof ReleaseEscrowArgsSchema>;
export type ConfirmDeliveryArgs = z.infer<typeof ConfirmDeliveryArgsSchema>;
export type UpdateStatusArgs = z.infer<typeof UpdateStatusArgsSchema>;
export type ChainTxResult = z.infer<typeof ChainTxResultSchema>;

// ─── Events ──────────────────────────────────────────────────────────────────

export const CHAIN_EVENT_NAMES = {
  ANCHOR: 'anchor',
  ESCROW_INIT: 'esc_init',
  ESCROW_RELEASE: 'esc_rel',
  ESCROW_DISPUTE: 'esc_dispute',
  ESCROW_RESOLVE: 'esc_resolve',
  ESCROW_FREEZE: 'esc_freeze',
  ESCROW_UNFREEZE: 'esc_unfreeze',
  DELIVERY_SUCCESS: 'delivery_success',
  ESCROW_RELEASED: 'escrow_released',
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

/** topic `["esc_dispute", payment_id]` · data `(reason_hash: Bytes32Hex)` — opens a dispute record */
export const EscrowDisputeEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ESCROW_DISPUTE),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ESCROW_DISPUTE), SymbolSchema]),
    data: z.tuple([Bytes32HexSchema]),
  })
  .strict();

/** topic `["esc_resolve", payment_id]` · data `(outcome: Symbol)` — resolves a dispute with a reflected outcome */
export const EscrowResolveEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ESCROW_RESOLVE),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ESCROW_RESOLVE), SymbolSchema]),
    data: z.tuple([SymbolSchema]),
  })
  .strict();

/** topic `["esc_freeze", payment_id]` · data `()` — freezes escrow state */
export const EscrowFreezeEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ESCROW_FREEZE),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ESCROW_FREEZE), SymbolSchema]),
    data: z.tuple([]),
  })
  .strict();

/** topic `["esc_unfreeze", payment_id]` · data `()` — unfreezes escrow state */
export const EscrowUnfreezeEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ESCROW_UNFREEZE),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ESCROW_UNFREEZE), SymbolSchema]),
    data: z.tuple([]),
  })
  .strict();

/** topic `["delivery_success", shipment_id]` · data `(proof_hash, receiver)` — co-emitted by confirm_delivery */
export const DeliverySuccessEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.DELIVERY_SUCCESS),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.DELIVERY_SUCCESS), SymbolSchema]),
    data: z.tuple([Bytes32HexSchema, AddressSchema]),
  })
  .strict();

/** topic `["escrow_released", shipment_id]` · data `(proof_hash, receiver)` — co-emitted by confirm_delivery */
export const EscrowReleasedEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ESCROW_RELEASED),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ESCROW_RELEASED), SymbolSchema]),
    data: z.tuple([Bytes32HexSchema, AddressSchema]),
  })
  .strict();

/** Runtime validator for the indexer and golden fixtures. */
export const ChainEventSchema = z.discriminatedUnion('name', [
  AnchorEventSchema,
  EscrowInitEventSchema,
  EscrowReleaseEventSchema,
  EscrowDisputeEventSchema,
  EscrowResolveEventSchema,
  EscrowFreezeEventSchema,
  EscrowUnfreezeEventSchema,
  DeliverySuccessEventSchema,
  EscrowReleasedEventSchema,
]);

export type AnchorEvent = z.infer<typeof AnchorEventSchema>;
export type EscrowInitEvent = z.infer<typeof EscrowInitEventSchema>;
export type EscrowReleaseEvent = z.infer<typeof EscrowReleaseEventSchema>;
export type EscrowDisputeEvent = z.infer<typeof EscrowDisputeEventSchema>;
export type EscrowResolveEvent = z.infer<typeof EscrowResolveEventSchema>;
export type EscrowFreezeEvent = z.infer<typeof EscrowFreezeEventSchema>;
export type EscrowUnfreezeEvent = z.infer<typeof EscrowUnfreezeEventSchema>;
export type DeliverySuccessEvent = z.infer<typeof DeliverySuccessEventSchema>;
export type EscrowReleasedEvent = z.infer<typeof EscrowReleasedEventSchema>;
export type ChainEvent = z.infer<typeof ChainEventSchema>;

/** An RPC event that could not be decoded, retained for indexing and replay. */
export interface ChainEventDecodeFailure {
  kind: 'decode_error';
  cursor: string;
  contract_id: string;
  raw_payload: unknown;
  candidate_payload: unknown;
  error: string;
}

export function isChainEventDecodeFailure(
  event: ChainEvent | ChainEventDecodeFailure
): event is ChainEventDecodeFailure {
  return 'kind' in event && event.kind === 'decode_error';
}

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
 * `NavinError` discriminants the REAL shipment contract can raise from
 * `update_status` (Navin-xmr/navin-contracts `errors.rs`). The legacy table
 * above predates the deployed contract and numbers errors differently
 * (e.g. its `InvalidStatus` is 9, the contract's is 5), so update_status errors
 * are decoded with this function-scoped table — never the legacy one.
 */
export const UPDATE_STATUS_CONTRACT_ERRORS = {
  Unauthorized: 3,
  ShipmentNotFound: 4,
  InvalidStatus: 5,
  InvalidHash: 6,
  ShipmentFinalized: 38,
  DuplicateAction: 41,
} as const;
export type UpdateStatusContractErrorName = keyof typeof UPDATE_STATUS_CONTRACT_ERRORS;

export const UPDATE_STATUS_ERROR_MAP: Readonly<
  Record<UpdateStatusContractErrorName, { code: ErrorCode; status: number }>
> = {
  Unauthorized: { code: ErrorCodes.CHAIN_UNAUTHORIZED, status: 403 },
  ShipmentNotFound: { code: ErrorCodes.CHAIN_SHIPMENT_NOT_FOUND, status: 404 },
  InvalidStatus: { code: ErrorCodes.CHAIN_INVALID_STATUS, status: 409 },
  InvalidHash: { code: ErrorCodes.CHAIN_INVALID_HASH, status: 422 },
  ShipmentFinalized: { code: ErrorCodes.CHAIN_INVALID_STATUS, status: 409 },
  DuplicateAction: { code: ErrorCodes.CHAIN_DUPLICATE_ACTION, status: 409 },
};

const updateStatusErrorNameByCode = new Map<number, UpdateStatusContractErrorName>(
  (Object.entries(UPDATE_STATUS_CONTRACT_ERRORS) as [UpdateStatusContractErrorName, number][]).map(
    ([n, c]) => [c, n]
  )
);

/**
 * Decode a contract error raised by `update_status`. Unlisted codes become
 * ERR_CHAIN_UNKNOWN (502) with the raw code preserved in `details`.
 */
export function updateStatusErrorToAppError(contractCode: number): AppError {
  const name = updateStatusErrorNameByCode.get(contractCode);
  if (!name) {
    return new AppError(
      502,
      `Unmapped update_status contract error ${contractCode} (spec ${CHAIN_SPEC_VERSION})`,
      ErrorCodes.CHAIN_UNKNOWN,
      { contractCode, function: 'update_status' }
    );
  }
  const { code, status } = UPDATE_STATUS_ERROR_MAP[name];
  return new AppError(status, `Chain contract error: ${name}`, code, {
    contractCode,
    function: 'update_status',
  });
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
