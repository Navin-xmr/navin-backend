import { Schema, Types, model } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export interface ITelemetryThreshold {
  _id: string;
  organizationId: Types.ObjectId;
  shipmentType: string;
  maxTemp?: number | null;
  minTemp?: number | null;
  maxHumidity?: number | null;
  minHumidity?: number | null;
  minBatteryLevel?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const TelemetryThresholdSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    shipmentType: { type: String, required: true, default: 'DEFAULT' },
    maxTemp: { type: Number, default: null },
    minTemp: { type: Number, default: null },
    maxHumidity: { type: Number, default: null },
    minHumidity: { type: Number, default: null },
    minBatteryLevel: { type: Number, default: null },
  },
  { timestamps: true }
);

TelemetryThresholdSchema.plugin(isoDatePlugin);

TelemetryThresholdSchema.index({ organizationId: 1, shipmentType: 1 }, { unique: true });

export const TelemetryThreshold = model<ITelemetryThreshold>(
  'TelemetryThreshold',
  TelemetryThresholdSchema
);
