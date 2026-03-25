import { Telemetry } from './telemetry.model.js';

export async function createTelemetryRecord(input: {
  shipmentId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: Date;
  dataHash: string;
  stellarTxHash: string;
  rawPayload: unknown;
}) {
  return Telemetry.create({
    shipmentId: input.shipmentId,
    temperature: input.temperature,
    humidity: input.humidity,
    latitude: input.latitude,
    longitude: input.longitude,
    batteryLevel: input.batteryLevel,
    timestamp: input.timestamp,
    dataHash: input.dataHash,
    stellarTxHash: input.stellarTxHash,
    rawPayload: input.rawPayload,
  });
}

