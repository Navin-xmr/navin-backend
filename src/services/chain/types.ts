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
import type { AnchorArgs, ChainEvent, ReleaseEscrowArgs } from '../../shared/types/chain.js';

/** Backend error codes an adapter may reject with (via `AppError.code`). */
export type ChainErrorCode = Extract<ErrorCode, `ERR_CHAIN_${string}`>;

/** Input for `anchor(shipment_id, data_hash, actor)` — spec-validated shape. */
export type AnchorEventInput = AnchorArgs;

/** Input for `release_escrow(payment_id, proof_hash)` — spec-validated shape. */
export type ReleaseEscrowInput = ReleaseEscrowArgs;

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

/** Opaque resume position: the `id` of the last event processed. */
export type ChainEventCursor = ChainEvent['id'];

export interface ChainAdapter {
  /**
   * Anchor a payload hash for a shipment.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ALREADY_ANCHORED).
   */
  anchorEvent(input: AnchorEventInput, options?: ChainSubmitOptions): Promise<AnchorResult>;

  /**
   * Release escrowed funds against a delivery proof hash.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ESCROW_NOT_FOUND).
   */
  releaseEscrow(input: ReleaseEscrowInput, options?: ChainSubmitOptions): Promise<EscrowResult>;

  /**
   * Spec-validated contract events in ledger order, resuming strictly after
   * `cursor` (from the beginning when omitted). Consumers stop with `break`;
   * implementations must release resources in the iterator's `return()`.
   * @throws {AppError} ERR_CHAIN_INVALID_EVENT when an emitted event violates the spec.
   */
  streamEvents(cursor?: ChainEventCursor): AsyncIterable<ChainEvent>;

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
}
