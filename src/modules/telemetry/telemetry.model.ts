import { Schema, Types, model } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';
import { ITelemetry, TelemetryAnchorStatus } from '../../shared/types/telemetry.js';

const TelemetrySchema = new Schema(
  {
    // metaField — identifies the sensor source
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

    // Keep the original webhook payload for traceability/auditing.
    rawPayload: { type: Schema.Types.Mixed, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TelemetrySchema.plugin(isoDatePlugin);

TelemetrySchema.index({ shipmentId: 1, timestamp: -1 });
TelemetrySchema.index({ sensorId: 1, shipmentId: 1, timestamp: -1 });
TelemetrySchema.index({ anchorStatus: 1 });

TelemetrySchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

TelemetrySchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const Telemetry = model<ITelemetry>('Telemetry', TelemetrySchema);
export { TelemetryAnchorStatus };
