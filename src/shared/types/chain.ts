/**
 * Chain interface — typed mirror of docs/chain-interface.md (TODO I2).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ SPEC VERSION: 2.2.0  (see CHAIN_SPEC_VERSION below)                  │
 * │ Mirrors the v2 surface (v1 from P6-01/#649, evolved by #1056/#1058):  │
 * │   functions  anchor · init_escrow · release_escrow (+ authz)         │
 * │              update_status (v2.1, #1047 — real contract ABI)         │
 * │              release_escrow = (caller, shipment_id), escrow is       │
 * │              per-shipment — there is no proof_hash argument.         │
 * │   events     anchor · esc_init · esc_rel (topic + data tuples)       │
 * │              dispute_raised · dispute_resolved · escrow_frozen       │
 * │              (v2.2, #1053 — real contract dispute surface)           │
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

export const CHAIN_SPEC_VERSION = '2.2.0' as const;

// ─── Soroban primitives ──────────────────────────────────────────────────────

const I128_MAX = (BigInt(1) << BigInt(127)) - BigInt(1);
const I128_MIN = -(BigInt(1) << BigInt(127));
const U32_MAX = 0xffffffff;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

/** Soroban `Symbol`: up to 32 chars of [a-zA-Z0-9_]. */
export const SymbolSchema = z.string().regex(/^[A-Za-z0-9_]{1,32}$/, 'Invalid Soroban Symbol');

/** Soroban `u64` represented in JSON as an unsigned decimal string. */
export const U64Schema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'Expected unsigned decimal u64 string')
  .refine(v => !/^(0|[1-9][0-9]*)$/.test(v) || BigInt(v) <= U64_MAX, 'Exceeds u64 range');

/**
 * Soroban `i128` represented in JSON as a signed decimal string.
 * Contract amounts use 7 decimal places; the integer is stroops/base units.
 */
export const I128Schema = z
  .string()
  .regex(/^(0|[1-9][0-9]*|-[1-9][0-9]*)$/, 'Expected signed decimal i128 string')
  .refine(
    v =>
      !/^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(v) || (BigInt(v) >= I128_MIN && BigInt(v) <= I128_MAX),
    'Outside i128 range'
  );

export const PositiveI128Schema = I128Schema.refine(
  v => !/^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(v) || BigInt(v) > 0,
  'Expected positive i128 amount'
);

/** `u32` — ledger sequence numbers. */
export const U32Schema = z.number().int().min(0).max(U32_MAX);

/** `Vec<(Symbol, u32)>` milestone representation. */
export const MilestoneVecSchema = z.array(z.tuple([SymbolSchema, U32Schema]));

export const RoleSchema = z.enum([
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'DRIVER',
  'VIEWER',
  'CUSTOMER',
]);

export const SettlementStatusSchema = z.enum([
  'PENDING',
  'ESCROWED',
  'RELEASED',
  'FAILED',
  'DISPUTED',
]);

export type Role = z.infer<typeof RoleSchema>;
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;
export type Milestone = z.infer<typeof MilestoneVecSchema>[number];

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
  /** v2.2 (#1053) — `raise_dispute` emitted this before `escrow_frozen`. */
  DISPUTE_RAISED: 'dispute_raised',
  /** v2.2 (#1053) — `resolve_dispute`; carries the contract's resolution. */
  DISPUTE_RESOLVED: 'dispute_resolved',
  /** v2.2 (#1053) — escrow blocked by a dispute/safety control (freeze). */
  ESCROW_FROZEN: 'escrow_frozen',
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

/**
 * Shipment identifier carried by the dispute/escrow-freeze events.
 *
 * The deployed contract types `shipment_id` as `u64`; this backend identifies
 * shipments by their Mongo ObjectId string and that is the identifier adapters
 * put on-chain (same legacy convention as `anchor`/`esc_*` above). Modelling it
 * as a Soroban `Symbol` is what lets the indexer resolve `LedgerBlock.shipmentId`
 * without an id-mapping table; reconciling the numeric contract id is tracked in
 * docs/chain-interface.md §1.1.
 */
const ShipmentEventIdSchema = SymbolSchema;

/** `DisputeResolution` contract enum — variant names are the on-chain identity. */
export const DISPUTE_RESOLUTIONS = [
  'ReleaseToCarrier',
  'RefundToCompany',
  'PartialRefund',
] as const;
export type DisputeResolutionName = (typeof DISPUTE_RESOLUTIONS)[number];
export const DisputeResolutionSchema = z.enum(DISPUTE_RESOLUTIONS);

/** `EscrowFreezeReason` contract enum — variant names are the on-chain identity. */
export const ESCROW_FREEZE_REASONS = [
  'DisputeRaised',
  'CarrierSuspended',
  'CompanySuspended',
  'ContractPaused',
  'CircuitBreakerOpen',
] as const;
export type EscrowFreezeReasonName = (typeof ESCROW_FREEZE_REASONS)[number];
export const EscrowFreezeReasonSchema = z.enum(ESCROW_FREEZE_REASONS);

/**
 * topic `["dispute_raised"]` · data `(shipment_id, raised_by, reason_hash)`
 *
 * Emitted by `raise_dispute` when a party opens a dispute. The full evidence
 * (text, photos) stays off-chain; only its SHA-256 digest is published, so the
 * indexer stores `reason_hash` verbatim and never treats it as free text.
 * `raise_dispute` also emits `escrow_frozen` immediately after this event.
 */
export const DisputeRaisedEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.DISPUTE_RAISED),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.DISPUTE_RAISED)]),
    data: z.tuple([ShipmentEventIdSchema, AddressSchema, Bytes32HexSchema]),
  })
  .strict();

/**
 * topic `["dispute_resolved"]` · data `(shipment_id, resolution, reason_hash, admin)`
 *
 * Emitted by `resolve_dispute` when an admin closes the dispute. `resolution` is
 * the contract's `DisputeResolution` variant and is reflected verbatim — the
 * projection must never re-derive it from the resulting shipment status. The
 * contract refunds/releases escrow before this event, which clears the freeze.
 */
export const DisputeResolvedEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.DISPUTE_RESOLVED),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.DISPUTE_RESOLVED)]),
    data: z.tuple([
      ShipmentEventIdSchema,
      DisputeResolutionSchema,
      Bytes32HexSchema,
      AddressSchema,
    ]),
  })
  .strict();

/**
 * topic `["escrow_frozen"]` · data `(shipment_id, reason, caller, timestamp)`
 *
 * Emitted whenever escrow is blocked (dispute, suspension, pause, circuit
 * breaker). Freeze is explicit on-chain state; the projection must not infer it.
 * The matching unfreeze is the `dispute_resolved` event — the contract clears
 * the freeze as part of resolution.
 */
export const EscrowFrozenEventSchema = z
  .object({
    ...eventEnvelope,
    name: z.literal(CHAIN_EVENT_NAMES.ESCROW_FROZEN),
    topic: z.tuple([z.literal(CHAIN_EVENT_NAMES.ESCROW_FROZEN)]),
    data: z.tuple([
      ShipmentEventIdSchema,
      EscrowFreezeReasonSchema,
      AddressSchema,
      U64StringSchema,
    ]),
  })
  .strict();

/** Runtime validator for the indexer and golden fixtures. */
export const ChainEventSchema = z.discriminatedUnion('name', [
  AnchorEventSchema,
  EscrowInitEventSchema,
  EscrowReleaseEventSchema,
  DisputeRaisedEventSchema,
  DisputeResolvedEventSchema,
  EscrowFrozenEventSchema,
]);

export type AnchorEvent = z.infer<typeof AnchorEventSchema>;
export type EscrowInitEvent = z.infer<typeof EscrowInitEventSchema>;
export type EscrowReleaseEvent = z.infer<typeof EscrowReleaseEventSchema>;
export type DisputeRaisedEvent = z.infer<typeof DisputeRaisedEventSchema>;
export type DisputeResolvedEvent = z.infer<typeof DisputeResolvedEventSchema>;
export type EscrowFrozenEvent = z.infer<typeof EscrowFrozenEventSchema>;
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
  MissingAuth: 10,
  InsufficientBudget: 11,
  MissingTrustline: 12,
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
  MissingAuth: { code: ErrorCodes.CHAIN_MISSING_AUTH, status: 403 },
  InsufficientBudget: { code: ErrorCodes.CHAIN_INSUFFICIENT_BUDGET, status: 402 },
  MissingTrustline: { code: ErrorCodes.CHAIN_MISSING_TRUSTLINE, status: 422 },
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
 * Translate an RPC simulation failure before transaction assembly.
 * Host diagnostics and contract discriminants are kept in `details.rawError`;
 * the raw contract code is always retained as `details.contractCode` when found.
 */
export function simulationErrorToAppError(
  rawError: unknown,
  decodeContractError: (code: number) => AppError = chainErrorToAppError
): AppError {
  const rawText =
    typeof rawError === 'string'
      ? rawError
      : rawError instanceof Error
        ? rawError.message
        : JSON.stringify(rawError);

  const contractCodeMatch =
    rawText.match(/(?:Contract,\s*#|contract error(?: code)?[:\s]*#?)(\d+)/i) ??
    rawText.match(/(?:Error\(Contract,\s*#)(\d+)/i);
  const contractCode = contractCodeMatch ? parseInt(contractCodeMatch[1], 10) : undefined;

  if (contractCode !== undefined) {
    const mapped = decodeContractError(contractCode);
    const mappedDetails =
      mapped.details && typeof mapped.details === 'object'
        ? (mapped.details as Record<string, unknown>)
        : {};
    if (mapped.code !== ErrorCodes.CHAIN_UNKNOWN || decodeContractError !== chainErrorToAppError) {
      return new AppError(mapped.statusCode, mapped.message, mapped.code, {
        ...mappedDetails,
        contractCode,
        rawError: rawText,
      });
    }
  }

  const normalized = rawText.toLowerCase();
  if (
    normalized.includes('missing auth') ||
    normalized.includes('missing authentication') ||
    normalized.includes('unauthorized') ||
    normalized.includes('not authorized')
  ) {
    return new AppError(
      403,
      'Soroban simulation failed: missing authorization',
      ErrorCodes.CHAIN_MISSING_AUTH,
      { contractCode, rawError: rawText }
    );
  }
  if (
    normalized.includes('insufficient budget') ||
    normalized.includes('resource limit') ||
    normalized.includes('fee') ||
    normalized.includes('budget exceeded')
  ) {
    return new AppError(
      402,
      'Soroban simulation failed: insufficient budget',
      ErrorCodes.CHAIN_INSUFFICIENT_BUDGET,
      { contractCode, rawError: rawText }
    );
  }
  if (normalized.includes('trustline') || normalized.includes('trust line')) {
    return new AppError(
      422,
      'Soroban simulation failed: missing trustline',
      ErrorCodes.CHAIN_MISSING_TRUSTLINE,
      { contractCode, rawError: rawText }
    );
  }

  return new AppError(400, 'Soroban simulation failed', ErrorCodes.CHAIN_UNKNOWN, {
    contractCode,
    rawError: rawText,
  });
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
