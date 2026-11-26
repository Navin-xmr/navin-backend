import { Schema, model, Types } from 'mongoose';

import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

/** P13-08 / #1028 — on-chain id ↔ off-chain shipment, persisted idempotently. */
export interface IChainShipmentMapping {
  chainShipmentId: string;
  /** Null while the chain event has no DB shipment yet (quarantined, never dropped). */
  shipmentId?: Types.ObjectId | null;
  sender: string;
  receiver: string;
  dataHash: string;
  txHash?: string;
  ledger?: number;
  status: 'MAPPED' | 'QUARANTINED';
  createdAt: Date;
  updatedAt: Date;
}

const ChainShipmentMappingSchema = new Schema<IChainShipmentMapping>(
  {
    chainShipmentId: { type: String, required: true, unique: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', default: null },
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    dataHash: { type: String, required: true },
    txHash: { type: String },
    ledger: { type: Number },
    status: { type: String, enum: ['MAPPED', 'QUARANTINED'], required: true },
  },
  { timestamps: true }
);

ChainShipmentMappingSchema.plugin(isoDatePlugin);

export const ChainShipmentMapping = model<IChainShipmentMapping>(
  'ChainShipmentMapping',
  ChainShipmentMappingSchema
);
