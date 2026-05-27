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
      uploadedAt: { type: Date },
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ShipmentSchema.plugin(isoDatePlugin);

ShipmentSchema.index({ status: 1, createdAt: -1 });
ShipmentSchema.index({ enterpriseId: 1, createdAt: -1 });
ShipmentSchema.index({ logisticsId: 1, createdAt: -1 });
ShipmentSchema.index({ createdAt: -1, _id: -1 });
ShipmentSchema.index({ createdAt: -1, logisticsId: 1, 'milestones.name': 1 });

// Soft delete middleware
ShipmentSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

ShipmentSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const Shipment = model<IShipment>('Shipment', ShipmentSchema);
export { ShipmentStatus };
