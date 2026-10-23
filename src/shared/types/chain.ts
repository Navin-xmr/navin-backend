/**
 * Chain interface — typed mirror of docs/chain-interface.md (TODO I2).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ SPEC VERSION: 1.0.0-draft  (see CHAIN_SPEC_VERSION below)            │
 * │ Mirrors the v1 surface defined by P6-01 (#649) / TODO I1:            │
 * │   functions  anchor · init_escrow · release_escrow (+ authz)         │
 * │   events     anchor · esc_init · esc_rel (topic + data tuples)       │
 * │   errors     contract error codes → ERR_CHAIN_* backend codes        │
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

export const CHAIN_SPEC_VERSION = '1.0.0-draft' as const;

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

/** `release_escrow(payment_id: Symbol, proof_hash: BytesN<32>)` — auth: contract admin. */
export const ReleaseEscrowArgsSchema = z
  .object({
    payment_id: SymbolSchema,
    proof_hash: Bytes32HexSchema,
  })
  .strict();

/** Result of any confirmed state-changing invocation. */
export const ChainTxResultSchema = z
  .object({
    tx_hash: TxHashSchema,
    ledger: U32Schema,
  })
  .strict();

export const CHAIN_FUNCTIONS = ['anchor', 'init_escrow', 'release_escrow'] as const;
export type ChainFunctionName = (typeof CHAIN_FUNCTIONS)[number];

/** Who must `require_auth()` for each function, per spec. */
export const CHAIN_FUNCTION_AUTH: Readonly<Record<ChainFunctionName, 'actor' | 'payer' | 'admin'>> =
  {
    anchor: 'actor',
    init_escrow: 'payer',
    release_escrow: 'admin',
  };

export const ChainFunctionArgsSchemas = {
  anchor: AnchorArgsSchema,
  init_escrow: InitEscrowArgsSchema,
  release_escrow: ReleaseEscrowArgsSchema,
} as const satisfies Record<ChainFunctionName, z.ZodTypeAny>;

export type AnchorArgs = z.infer<typeof AnchorArgsSchema>;
export type InitEscrowArgs = z.infer<typeof InitEscrowArgsSchema>;
export type ReleaseEscrowArgs = z.infer<typeof ReleaseEscrowArgsSchema>;
export type ChainTxResult = z.infer<typeof ChainTxResultSchema>;

// ─── Events ──────────────────────────────────────────────────────────────────

export const CHAIN_EVENT_NAMES = {
  ANCHOR: 'anchor',
  ESCROW_INIT: 'esc_init',
  ESCROW_RELEASE: 'esc_rel',
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

/** Runtime validator for the indexer and golden fixtures. */
export const ChainEventSchema = z.discriminatedUnion('name', [
  AnchorEventSchema,
  EscrowInitEventSchema,
  EscrowReleaseEventSchema,
]);

export type AnchorEvent = z.infer<typeof AnchorEventSchema>;
export type EscrowInitEvent = z.infer<typeof EscrowInitEventSchema>;
export type EscrowReleaseEvent = z.infer<typeof EscrowReleaseEventSchema>;
export type ChainEvent = z.infer<typeof ChainEventSchema>;

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
