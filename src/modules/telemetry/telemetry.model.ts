import { Schema, Types, model } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';
import {
  ITelemetry,
  TelemetryAnchorStatus,
  TELEMETRY_ANOMALY_TYPES,
} from '../../shared/types/telemetry.js';

const TelemetrySchema = new Schema(
  {
    // metaField — identifies the sensor source when provided by upstream systems
    sensorId: { type: String },

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

    // New fields for frontend anomaly alignment
    shockMagnitude: { type: Number, min: 0 },
    isAnomaly: { type: Boolean, default: false, index: true },
    anomalyType: {
      type: String,
      enum: TELEMETRY_ANOMALY_TYPES,
      default: null,
    },

    // Keep the original webhook payload for traceability/auditing.
    rawPayload: { type: Schema.Types.Mixed, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TelemetrySchema.plugin(isoDatePlugin);

// Optimizes retrieving telemetry data points for a specific shipment, sorted by timestamp descending (newest first) for charting.
TelemetrySchema.index({ shipmentId: 1, timestamp: -1 });

// Optimizes checking/filtering telemetry data for a specific sensor tracking a specific shipment, sorted by timestamp descending.
TelemetrySchema.index({ sensorId: 1, shipmentId: 1, timestamp: -1 });
TelemetrySchema.index({ anchorStatus: 1 });

// New indexes for anomaly filtering
TelemetrySchema.index({ isAnomaly: 1, timestamp: -1 });
TelemetrySchema.index({ shipmentId: 1, isAnomaly: 1, timestamp: -1 });
TelemetrySchema.index({ anomalyType: 1, timestamp: -1 });

TelemetrySchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

TelemetrySchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const Telemetry = model<ITelemetry>('Telemetry', TelemetrySchema);
export { TelemetryAnchorStatus };
