import { Schema, model, Types } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';
import { IShipment, ShipmentStatus } from '../../shared/types/shipment.js';

const MilestoneSchema = new Schema({
  name: { type: String, required: true },
  timestamp: { type: Date, required: true },
  description: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  walletAddress: { type: String },
});

MilestoneSchema.plugin(isoDatePlugin);

const ShipmentSchema = new Schema(
  {
    trackingNumber: { type: String, required: true, unique: true },
    origin: { type: String, required: true },
    destination: { type: String, required: true },
    enterpriseId: { type: Types.ObjectId, ref: 'Enterprise', required: true },
    logisticsId: { type: Types.ObjectId, ref: 'Logistics', required: true },
    status: { type: String, enum: Object.values(ShipmentStatus), default: ShipmentStatus.CREATED },
    milestones: { type: [MilestoneSchema], default: [] },
    offChainMetadata: { type: Schema.Types.Mixed },
    stellarTokenId: { type: String },
    stellarTxHash: { type: String },
    deliveryProof: {
      url: { type: String },
      recipientSignatureName: { type: String },
      notes: { type: String },
      uploadedAt: { type: Date },
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ShipmentSchema.plugin(isoDatePlugin);

// Optimizes filtering shipments by their operational status, sorted by creation date descending (newest first).
ShipmentSchema.index({ status: 1, createdAt: -1 });

// Optimizes retrieving shipments for a specific enterprise customer, sorted by creation date descending.
ShipmentSchema.index({ enterpriseId: 1, createdAt: -1 });

// Optimizes retrieving shipments for a specific logistics carrier, sorted by creation date descending.
ShipmentSchema.index({ logisticsId: 1, createdAt: -1 });

// Optimizes global shipment listings sorted by creation date descending with deterministic pagination.
ShipmentSchema.index({ createdAt: -1, _id: -1 });

// Multi-field text index optimizing free-text search across origin and destination locations.
ShipmentSchema.index({ origin: 'text', destination: 'text' });

// Soft delete middleware
ShipmentSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

ShipmentSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const Shipment = model<IShipment>('Shipment', ShipmentSchema);
export { ShipmentStatus };
