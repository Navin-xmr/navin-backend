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
  ReleaseEscrowArgs,
  UpdateStatusArgs,
} from '../../shared/types/chain.js';

/** Backend error codes an adapter may reject with (via `AppError.code`). */
export type ChainErrorCode = Extract<ErrorCode, `ERR_CHAIN_${string}`>;

/** Input for `anchor(shipment_id, data_hash, actor)` — spec-validated shape. */
export type AnchorEventInput = AnchorArgs;

/** Input for `release_escrow(caller, shipment_id)` — spec-validated shape (v2). */
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

/** Opaque resume position: the `id` of the last event processed. */
export type ChainEventCursor = ChainEvent['id'];

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
   * Record a shipment status transition on-chain, authorized by `caller`.
   * The caller supplies the canonical-payload `data_hash`; it is passed through unchanged.
   * @throws {AppError} ERR_CHAIN_INVALID_STATUS (illegal transition / finalized shipment),
   * ERR_CHAIN_DUPLICATE_ACTION (idempotency window), ERR_CHAIN_UNAUTHORIZED,
   * ERR_CHAIN_SHIPMENT_NOT_FOUND, ERR_CHAIN_INVALID_HASH; other contract errors surface as
   * ERR_CHAIN_UNKNOWN with the raw code in `details`.
   */
  updateStatus(input: UpdateStatusInput): Promise<UpdateStatusResult>;

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
}
