import { Schema, model, Types } from 'mongoose';

export enum ShipmentStatus {
  CREATED = 'CREATED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

const MilestoneSchema = new Schema({
  name: { type: String, required: true },
  timestamp: { type: Date, required: true },
  description: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  walletAddress: { type: String },
});

const ShipmentSchema = new Schema({
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
}, { timestamps: true });

export const Shipment = model('Shipment', ShipmentSchema);
