import { Schema, model, Types } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';
import { MilestoneEvent } from '../../shared/types/shipment.js';

export interface ILedgerBlock {
  _id: string;
  blockNumber: number;
  timestamp: Date;
  shipmentId: Types.ObjectId;
  shipmentReference?: string;
  /** Canonical event field.  Always populated; never null after migration #661. */
  milestoneEvent: MilestoneEvent;
  /**
   * SHA-256 hex digest of the payload committed by the on-chain transaction.
   * Allows independent verification that `transactionHash` covers the expected data.
   */
  dataHash?: string;
  /**
   * Exact deterministic payload that was hashed into `dataHash`.
   * Persisted alongside every dataHash so verifiers never re-guess bytes.
   */
  canonicalPayload?: Record<string, unknown>;
  /** #994 — v2 chain event spec version. Legacy rows default to 1. */
  schemaVersion: number;
  /** #994 — monotonically increasing event counter within the shipment/contract. */
  eventCounter: number;
  /** #994 — contract event topic name (e.g. `create_shipment`). */
  eventTopic?: string;
  transactionHash?: string;
  /**
   * #1046 — deployment the block was written under (`testnet` | `public`). Persisted at write
   * time so verification never depends on the server's *current* config. Absent on legacy rows.
   */
  network?: 'testnet' | 'public';
  /** #994 / #1046 — Soroban contract the transaction targeted, when known at write time. */
  contractId?: string;
  /** #994 / #1046 — stable idempotency key for deduplicating requests and replayed v2 events. */
  idempotencyKey?: string;
  ledger: number;
  /** #1058 — ledgers closed strictly after `ledger`; recomputed idempotently. */
  confirmations: number;
  verified: boolean;
  actor?: string;
  metadata?: Record<string, unknown>;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LedgerBlockSchema = new Schema(
  {
    blockNumber: {
      type: Number,
      required: true,
      default: 0,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    shipmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
    },
    shipmentReference: {
      type: String,
    },
    milestoneEvent: {
      type: String,
      enum: Object.values(MilestoneEvent),
      required: true,
    },
    transactionHash: { type: String },
    network: { type: String, enum: ['testnet', 'public'] },
    contractId: { type: String },
    idempotencyKey: { type: String },
    dataHash: { type: String },
    canonicalPayload: { type: Schema.Types.Mixed },
    schemaVersion: { type: Number, required: true, default: 1 },
    eventCounter: { type: Number, required: true, default: 0 },
    eventTopic: { type: String },
    ledger: {
      type: Number,
      required: true,
      default: 0,
    },
    confirmations: {
      type: Number,
      required: true,
      default: 0,
    },
    verified: {
      type: Boolean,
      required: true,
      default: false,
    },
    actor: { type: String },
    metadata: { type: Schema.Types.Mixed },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

LedgerBlockSchema.plugin(isoDatePlugin);

// Optimizes querying ledger blocks for a specific shipment, newest first.
LedgerBlockSchema.index({ shipmentId: 1, milestoneEvent: 1, createdAt: -1 });

// Allows cross-shipment queries by milestone event type, newest first.
// Replaces the stale { eventType: 1, createdAt: -1 } index (issue #799).
LedgerBlockSchema.index({ milestoneEvent: 1, createdAt: -1 });

// Allows fast lookup / deduplication by on-chain data hash.
LedgerBlockSchema.index({ dataHash: 1 }, { sparse: true });

// #994 — v2 replay dedupe; sparse so all legacy rows (no key) remain valid.
LedgerBlockSchema.index({ idempotencyKey: 1 }, { sparse: true, unique: true });

// #1058 — supports idempotent re-verification scans of not-yet-confirmed blocks.
LedgerBlockSchema.index({ verified: 1, ledger: 1 });

// P13-02 — DB-enforced deduplication on idempotencyKey.
// Partial index excludes legacy rows without a key so they remain unaffected.
LedgerBlockSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Soft delete middleware
LedgerBlockSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

LedgerBlockSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const LedgerBlock = model<ILedgerBlock>('LedgerBlock', LedgerBlockSchema);
