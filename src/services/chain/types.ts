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
  anchorEvent(input: AnchorEventInput): Promise<AnchorResult>;

  /**
   * Release escrowed funds against a delivery proof hash.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ESCROW_NOT_FOUND).
   */
  releaseEscrow(input: ReleaseEscrowInput): Promise<EscrowResult>;

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
}
