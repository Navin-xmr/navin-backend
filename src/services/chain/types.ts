/**
 * ChainAdapter port (TODO J1 · P6-03).
 *
 * The only chain surface domain modules may depend on. Implementations
 * (SimulatedAdapter, SorobanAdapter) live beside this file and are selected by
 * config; `telemetry`/`payments`/`shipments`/`webhooks` import from HERE only —
 * never an implementation, never `stellar.service.ts` (AGENTS.md §7).
 *
 * Chain wire shapes (args, events) come from src/shared/types/chain.ts and are
 * not redefined here.
 *
 * Error contract: every method rejects with `AppError` carrying a
 * `ChainErrorCode` (`ERR_CHAIN_*`). Methods never resolve with a failure flag —
 * this replaces the silent `{ success: false }` of stellar.service.ts
 * `releaseEscrow()`. A resolved promise means the transaction is confirmed.
 */
import type { ErrorCode } from '../../shared/http/errors.js';
import type {
  AnchorArgs,
  ChainEvent,
  ChainEventDecodeFailure,
  ConfirmDeliveryArgs,
  RefundEscrowArgs,
  ReleaseEscrowArgs,
  UpdateStatusArgs,
} from '../../shared/types/chain.js';

/** Backend error codes an adapter may reject with (via `AppError.code`). */
export type ChainErrorCode = Extract<ErrorCode, `ERR_CHAIN_${string}`>;

/** Input for `anchor(shipment_id, data_hash, actor)` — spec-validated shape. */
export type AnchorEventInput = AnchorArgs;

/** Input for `release_escrow(caller, shipment_id)` — spec-validated shape (v2). */
export type ReleaseEscrowInput = ReleaseEscrowArgs;

/** Input for `confirm_delivery(receiver, shipment_id, proof_hash)` — spec-validated shape. */
export type ConfirmDeliveryInput = ConfirmDeliveryArgs;

/**
 * Optional identity of the logical event being submitted (#1078). When given,
 * the adapter derives a deterministic idempotency key from
 * (shipment_id, event_type, event_counter): a repeat of the same event returns
 * the original receipt instead of submitting again, and a retry after a
 * timeout first checks chain state for the earlier attempt.
 */
export interface ChainSubmitOptions {
  eventType: string;
  /** Per-shipment, per-event-type counter; the same event must reuse the same value. */
  eventCounter: number;
  /** Needed for `releaseEscrow`, whose input carries a payment ID, not a shipment ID. */
  shipmentId?: string;
}

/** Input for `refund_escrow(caller, shipment_id)` — spec-validated shape (P14-08). */
export type RefundEscrowInput = RefundEscrowArgs;

/**
 * Input for `update_status(caller, shipment_id, new_status, data_hash)`.
 * `data_hash` is the backend-computed hash of the canonical status payload; the
 * adapter encodes and submits it verbatim and never recomputes or alters it.
 */
export type UpdateStatusInput = UpdateStatusArgs;

/** Confirmed on-chain transaction. */
export interface ChainTxReceipt {
  /** 64-char lowercase hex transaction hash. */
  txHash: string;
  /** Ledger sequence the transaction was confirmed in. */
  ledger: number;
  /** `true` when produced by the simulated adapter — no real contract call or funds moved. */
  simulated: boolean;
}

export type AnchorResult = ChainTxReceipt;

export interface UpdateStatusResult extends ChainTxReceipt {
  /** On-chain (u64, decimal string) shipment id the status was applied to. */
  shipmentId: UpdateStatusInput['shipment_id'];
  newStatus: UpdateStatusInput['new_status'];
}

export interface EscrowResult extends ChainTxReceipt {
  /** Escrow is per-shipment (#1056) — this is the released shipment, not a payment id. */
  shipmentId: ReleaseEscrowInput['shipment_id'];
}

export interface ConfirmDeliveryResult extends ChainTxReceipt {
  receiver: ConfirmDeliveryInput['receiver'];
  shipmentId: ConfirmDeliveryInput['shipment_id'];
}

/** P14-08 — the refunded shipment; the amount arrives via `escrow_refunded`. */
export interface RefundResult extends ChainTxReceipt {
  shipmentId: RefundEscrowInput['shipment_id'];
}

/** Opaque resume position: the `id` of the last event processed. */
export type ChainEventCursor = ChainEvent['id'];

/** ─── Read-only chain state (simulation only, short-TTL cacheable) ─── */

/** Input for reading an escrow balance. */
export interface ReadEscrowBalanceInput {
  payment_id: string;
}

/** Escrow balance read result. Balance is in stroops as a decimal string. */
export interface ReadEscrowBalanceResult {
  /** Balance in stroops (1 XLM = 10^7 stroops), as a decimal string. */
  balance: string;
  simulated: boolean;
}

/** Input for reading a shipment's on-chain status. */
export interface ReadShipmentStatusInput {
  shipment_id: string;
}

/** Shipment on-chain status read result. */
export interface ReadShipmentStatusResult {
  /** Derived on-chain milestone/status (e.g. ESCROWED, RELEASED, REFUNDED). */
  status: string;
  simulated: boolean;
}

/** Contract version read result. */
export interface ReadContractVersionResult {
  /** Contract / spec version string. */
  version: string;
  simulated: boolean;
}

/** Result shape shared by all read-only chain queries. */
export type ChainReadResult<T> = T & { simulated: boolean };

/**
 * On-chain shipment ID (`u64` in the shipment contract). How it maps to the
 * Mongo ObjectId is decided by P11-10; reads take the on-chain value.
 */
export type ChainShipmentId = bigint;

/**
 * `ShipmentStatus` unit variants from the shipment contract ABI. Defined here
 * until the v2 contract types land in src/shared/types/chain.ts (P11-05).
 */
export const CHAIN_SHIPMENT_STATUSES = [
  'Created',
  'InTransit',
  'AtCheckpoint',
  'PartiallyDelivered',
  'Delivered',
  'Disputed',
  'Cancelled',
] as const;
export type ChainShipmentStatus = (typeof CHAIN_SHIPMENT_STATUSES)[number];

/**
 * `Shipment` struct as decoded from `get_shipment`: field names are the
 * contract's snake_case names, `u64`/`i128` values are `bigint`, addresses
 * are strings, and `Option::None` is `null`. Typed loosely until P11-05 models
 * the struct.
 */
export type ChainShipmentRecord = Readonly<Record<string, unknown>>;

export interface ChainAdapter {
  /**
   * Anchor a payload hash for a shipment.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ALREADY_ANCHORED).
   */
  anchorEvent(input: AnchorEventInput, options?: ChainSubmitOptions): Promise<AnchorResult>;

  /**
   * Release escrowed funds for a shipment, authorized by `caller`.
   * Escrow is per-shipment (#1056); there is no payment id or proof hash here.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ESCROW_NOT_FOUND,
   * ERR_CHAIN_INVALID_STATUS, ERR_CHAIN_UNAUTHORIZED). Never resolves with a
   * `{ success: false }` failure flag.
   */
  releaseEscrow(input: ReleaseEscrowInput, options?: ChainSubmitOptions): Promise<EscrowResult>;

  /**
   * Refund escrow for a cancelled/expired shipment, authorized by `caller`.
   * Resolves only when the refund transaction is confirmed; the off-chain
   * payment record must then be reconciled from the `escrow_refunded` event.
   * @throws {AppError} ERR_CHAIN_* on rejection.
   */
  refundEscrow?(input: RefundEscrowInput, options?: ChainSubmitOptions): Promise<RefundResult>;

  /**
   * Update a shipment's on-chain status (`update_status`).
   * @throws {AppError} `ChainErrorCode` on rejection.
   */
  updateStatus(input: UpdateStatusInput): Promise<UpdateStatusResult>;

  /**
   * Confirm delivery of a shipment — co-emits `delivery_success` and `escrow_released` events.
   * Only the `receiver` (auth precondition) may call this.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_UNAUTHORIZED).
   */
  confirmDelivery(input: ConfirmDeliveryInput): Promise<ConfirmDeliveryResult>;

  /**
   * Spec-validated contract events in ledger order, resuming strictly after
   * `cursor` (from the beginning when omitted). Consumers stop with `break`;
   * implementations must release resources in the iterator's `return()`.
   * @throws {AppError} ERR_CHAIN_INVALID_EVENT when an emitted event violates the spec.
   */
  streamEvents(cursor?: ChainEventCursor): AsyncIterable<ChainEvent>;

  /**
   * Optional event stream that surfaces decode failures as `ChainEventDecodeFailure`
   * so consumers can persist and alert on them without halting the stream.
   */
  streamEventsWithFailures?(
    cursor?: ChainEventCursor
  ): AsyncIterable<ChainEvent | ChainEventDecodeFailure>;

  /**
   * Optional read-only ledger queries used by confirmation tracking (#818).
   * `getLatestLedger` returns the current ledger sequence. `getTransactionLedger`
   * returns the ledger containing a successful transaction, or null when the
   * transaction is not found or did not succeed.
   */
  getLatestLedger?(): Promise<number>;
  getTransactionLedger?(txHash: string): Promise<number | null>;
  /**
   * Confirmation count for a transaction at `ledger`.
   * Implementations return at least three immediately for simulated chains.
   */
  getConfirmationCount(ledger: number): Promise<number>;

  /*
   * Optional contract reads (P12-14). Implemented by adapters backed by the
   * shipment contract; they use simulation only, so they never submit a
   * transaction, pay a fee, or need a signing key. Shipment-keyed reads resolve
   * `null` when the contract reports `ShipmentNotFound`.
   * @throws {AppError} ERR_CHAIN_UNKNOWN when the RPC call or decode fails.
   */
  getShipment?(shipmentId: ChainShipmentId): Promise<ChainShipmentRecord | null>;
  getShipmentStatus?(shipmentId: ChainShipmentId): Promise<ChainShipmentStatus | null>;
  /** Escrowed amount in the token's base units (`i128`). */
  getEscrowBalance?(shipmentId: ChainShipmentId): Promise<bigint | null>;
  getVersion?(): Promise<number>;
  /** Admin `G…`/`C…` address. */
  getAdmin?(): Promise<string>;
  getExpectedTokenDecimals?(): Promise<number>;

  /** Read-only chain state queries (P14-12, simulation only, short-TTL cacheable). */
  readEscrowBalance?(input: ReadEscrowBalanceInput): Promise<ReadEscrowBalanceResult>;
  readShipmentStatus?(input: ReadShipmentStatusInput): Promise<ReadShipmentStatusResult>;
  readContractVersion?(): Promise<ReadContractVersionResult>;
}
