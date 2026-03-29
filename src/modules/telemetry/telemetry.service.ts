import { Telemetry, TelemetryAnchorStatus } from './telemetry.model.js';
import type { FilterQuery } from 'mongoose';

export async function createTelemetryRecord(input: {
  shipmentId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: Date;
  dataHash: string;
  stellarTxHash?: string;
  anchorStatus?: TelemetryAnchorStatus;
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
    anchorStatus: input.anchorStatus || TelemetryAnchorStatus.PENDING_ANCHOR,
    rawPayload: input.rawPayload,
  });
}

export async function updateTelemetryAnchor(telemetryId: string, stellarTxHash: string) {
  return Telemetry.findByIdAndUpdate(
    telemetryId,
    {
      stellarTxHash,
      anchorStatus: TelemetryAnchorStatus.ANCHORED,
    },
    { new: true }
  );
}

export async function markTelemetryAnchorFailed(telemetryId: string, error: string) {
  return Telemetry.findByIdAndUpdate(
    telemetryId,
    {
      anchorStatus: TelemetryAnchorStatus.ANCHOR_FAILED,
      anchorError: error,
    },
    { new: true }
  );
}

export async function getTelemetryService(params: {
  cursor?: string;
  limit: number;
  shipmentId?: string;
}) {
  const { cursor, limit, shipmentId } = params;
  const query: FilterQuery<unknown> = {};

  if (shipmentId) query.shipmentId = shipmentId;
  if (cursor) query._id = { $lt: cursor };

  const telemetry = await Telemetry.find(query)
    .select('-__v -rawPayload')
    .sort({ timestamp: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = telemetry.length > limit;
  const data = hasMore ? telemetry.slice(0, limit) : telemetry;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]._id.toString() : null;

  return { data, nextCursor, hasMore };
}
