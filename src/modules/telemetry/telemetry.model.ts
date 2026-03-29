import { Schema, Types, model } from 'mongoose';

export enum TelemetryAnchorStatus {
  PENDING_ANCHOR = 'PENDING_ANCHOR',
  ANCHORED = 'ANCHORED',
  ANCHOR_FAILED = 'ANCHOR_FAILED',
}

const TelemetrySchema = new Schema(
  {
    // metaField — identifies the sensor source
    sensorId: { type: String, required: true },

    shipmentId: { type: Types.ObjectId, ref: 'Shipment', required: true },

    temperature: { type: Number, required: true },
    humidity: { type: Number, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    batteryLevel: { type: Number, required: true },
    // timeField — required by MongoDB time-series
    timestamp: { type: Date, required: true },

    dataHash: { type: String, required: true },
    stellarTxHash: { type: String },
    anchorStatus: {
      type: String,
      enum: Object.values(TelemetryAnchorStatus),
      default: TelemetryAnchorStatus.PENDING_ANCHOR,
    },
    anchorError: { type: String },

    // Keep the original webhook payload for traceability/auditing.
    rawPayload: { type: Schema.Types.Mixed, required: true },
  },
  {
    // Native MongoDB time-series collection configuration.
    // timeField must be the Date field; metaField groups measurements by sensor.
    timeseries: { timeField: 'timestamp', metaField: 'sensorId' },
  },
);

TelemetrySchema.index({ shipmentId: 1, timestamp: -1 });
TelemetrySchema.index({ anchorStatus: 1 });

export const Telemetry = model('Telemetry', TelemetrySchema);

