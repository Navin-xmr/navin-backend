import { Schema, model, Types } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

/** Punctuality of a delivery relative to the shipment deadline (`Shipment.expectedDelivery`). */
export enum DeliveryClassification {
  ON_TIME = 'ON_TIME',
  LATE = 'LATE',
  /** No deadline available (shipment unresolved or without `expectedDelivery`). */
  UNKNOWN = 'UNKNOWN',
}

/** One indexed contract event (`delivery_success` or `delivery_confirmed`). */
export interface IDeliveryEventRecord {
  /** RPC event id — the idempotency identity. */
  eventId: string;
  txHash: string;
  ledger: number;
  /** `delivery_time` from the event payload (chain clock), never the server clock. */
  deliveredAt: Date;
  /** `delivery_success`: the carrier. `delivery_confirmed`: the confirming receiver. */
  actor: string;
}

export interface IShipmentDelivery {
  _id: string;
  /** On-chain `u64` shipment id, decimal string. One record per on-chain shipment. */
  chainShipmentId: string;
  /** Backend shipment, when `Shipment.chainShipmentId` resolves it. */
  shipmentId?: Types.ObjectId;
  carrier?: string;
  receiver?: string;
  /** Chain-supplied delivery time: `delivery_success` wins over `delivery_confirmed`. */
  deliveryTime: Date;
  /** Snapshot of the deadline used to classify; makes the classification auditable. */
  deadline?: Date;
  classification: DeliveryClassification;
  success?: IDeliveryEventRecord;
  confirmed?: IDeliveryEventRecord;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EventRecordSchema = new Schema(
  {
    eventId: { type: String, required: true },
    txHash: { type: String, required: true },
    ledger: { type: Number, required: true },
    deliveredAt: { type: Date, required: true },
    actor: { type: String, required: true },
  },
  { _id: false }
);

const ShipmentDeliverySchema = new Schema(
  {
    chainShipmentId: { type: String, required: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment' },
    carrier: { type: String },
    receiver: { type: String },
    deliveryTime: { type: Date, required: true },
    deadline: { type: Date },
    classification: {
      type: String,
      enum: Object.values(DeliveryClassification),
      required: true,
    },
    success: { type: EventRecordSchema },
    confirmed: { type: EventRecordSchema },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ShipmentDeliverySchema.plugin(isoDatePlugin);

// One delivery record per on-chain shipment: both topics and any replay converge on it.
ShipmentDeliverySchema.index({ chainShipmentId: 1 }, { unique: true });
ShipmentDeliverySchema.index({ shipmentId: 1 }, { sparse: true });
// Carrier punctuality reporting.
ShipmentDeliverySchema.index({ carrier: 1, classification: 1 }, { sparse: true });

// Soft delete middleware
ShipmentDeliverySchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

ShipmentDeliverySchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const ShipmentDelivery = model<IShipmentDelivery>(
  'ShipmentDelivery',
  ShipmentDeliverySchema
);
