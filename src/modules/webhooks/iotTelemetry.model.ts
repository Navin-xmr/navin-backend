import { Schema, model } from 'mongoose';

const IotTelemetrySchema = new Schema(
  {
    sensorId: { type: String, required: true },
    timestamp: { type: Date, required: true },
    temp: { type: Number, required: true },
    humidity: { type: Number, required: true },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    shipmentId: { type: String },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'sensorId',
      granularity: 'seconds',
    },
    autoCreate: false,
  },
);

export const IotTelemetry = model('IotTelemetry', IotTelemetrySchema);
