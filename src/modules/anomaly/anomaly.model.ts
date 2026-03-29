import { Schema, Types, model } from 'mongoose';

export const ANOMALY_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

export const ANOMALY_TYPES = [
  'TEMPERATURE_EXCEEDED',
  'TEMPERATURE_BELOW_MIN',
  'HUMIDITY_EXCEEDED',
  'HUMIDITY_BELOW_MIN',
  'BATTERY_LOW',
] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

const AnomalySchema = new Schema(
  {
    shipmentId: { type: Types.ObjectId, ref: 'Shipment', required: true },
    type: { type: String, enum: ANOMALY_TYPES, required: true },
    severity: { type: String, enum: ANOMALY_SEVERITIES, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, required: true },
    resolved: { type: Boolean, default: false, required: true },
  },
  { timestamps: true, strict: true }
);

AnomalySchema.index({ shipmentId: 1, timestamp: -1, _id: -1 });
AnomalySchema.index({ resolved: 1, timestamp: -1, _id: -1 });
AnomalySchema.index({ severity: 1, timestamp: -1, _id: -1 });

export const Anomaly = model('Anomaly', AnomalySchema);
