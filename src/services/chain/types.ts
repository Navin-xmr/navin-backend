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
  ConfirmDeliveryArgs,
  ReleaseEscrowArgs,
} from '../../shared/types/chain.js';

/** Backend error codes an adapter may reject with (via `AppError.code`). */
export type ChainErrorCode = Extract<ErrorCode, `ERR_CHAIN_${string}`>;

/** Input for `anchor(shipment_id, data_hash, actor)` — spec-validated shape. */
export type AnchorEventInput = AnchorArgs;

/** Input for `release_escrow(payment_id, proof_hash)` — spec-validated shape. */
export type ReleaseEscrowInput = ReleaseEscrowArgs;

/** Input for `confirm_delivery(receiver, shipment_id, proof_hash)` — spec-validated shape. */
export type ConfirmDeliveryInput = ConfirmDeliveryArgs;

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

export interface EscrowResult extends ChainTxReceipt {
  paymentId: ReleaseEscrowInput['payment_id'];
}

export interface ConfirmDeliveryResult extends ChainTxReceipt {
  receiver: ConfirmDeliveryInput['receiver'];
  shipmentId: ConfirmDeliveryInput['shipment_id'];
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

export interface ChainAdapter {
  /**
   * Anchor a payload hash for a shipment.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ALREADY_ANCHORED).
   */
  anchorEvent(input: AnchorEventInput): Promise<AnchorResult>;

  /**
   * Release escrowed funds against a delivery proof hash.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ESCROW_NOT_FOUND).
   */
  releaseEscrow(input: ReleaseEscrowInput): Promise<EscrowResult>;

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
   * Read the escrow balance for a payment (simulation only, no state change).
   * @throws {AppError} `ChainErrorCode` on rejection.
   */
  readEscrowBalance(input: ReadEscrowBalanceInput): Promise<ReadEscrowBalanceResult>;

  /**
   * Read the on-chain shipment status for a shipment (simulation only).
   * @throws {AppError} `ChainErrorCode` on rejection.
   */
  readShipmentStatus(input: ReadShipmentStatusInput): Promise<ReadShipmentStatusResult>;

  /**
   * Read the contract / spec version (simulation only).
   * @throws {AppError} `ChainErrorCode` on rejection.
   */
  readContractVersion(): Promise<ReadContractVersionResult>;
}
