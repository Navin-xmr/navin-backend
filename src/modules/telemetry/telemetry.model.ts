import { Schema, Types, model } from 'mongoose';

const TelemetrySchema = new Schema(
  {
    shipmentId: { type: Types.ObjectId, ref: 'Shipment', required: true },

    temperature: { type: Number, required: true },
    humidity: { type: Number, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    batteryLevel: { type: Number, required: true },
    timestamp: { type: Date, required: true },

    dataHash: { type: String, required: true },
    stellarTxHash: { type: String, required: true },

    // Keep the original webhook payload for traceability/auditing.
    rawPayload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

export const Telemetry = model('Telemetry', TelemetrySchema);

