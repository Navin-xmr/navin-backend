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
  transactionHash?: string;
  ledger: number;
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
    dataHash: { type: String },
    ledger: {
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

// Optimizes filtering by event type across shipments.
LedgerBlockSchema.index({ eventType: 1, createdAt: -1 });

// Allows fast lookup / deduplication by on-chain data hash.
LedgerBlockSchema.index({ dataHash: 1 }, { sparse: true });

// Soft delete middleware
LedgerBlockSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

LedgerBlockSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const LedgerBlock = model<ILedgerBlock>('LedgerBlock', LedgerBlockSchema);
