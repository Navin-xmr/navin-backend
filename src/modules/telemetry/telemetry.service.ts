import { Telemetry, TelemetryAnchorStatus } from './telemetry.model.js';
import { Shipment } from '../shipments/shipments.model.js';
import { ShipmentStatus } from '../../shared/types/shipment.js';
import type { FilterQuery } from 'mongoose';
import { generateDataHash } from '../../shared/utils/crypto.js';
import { detectAnomaly } from '../anomaly/anomaly.service.js';
import { emitAnomalyDetected, emitTelemetryUpdate } from '../../infra/socket/io.js';
import type {
  AnomalyAlertPayload,
  TelemetryUpdatePayload,
} from '../../shared/types/socketEvents.js';
import type { BulkTelemetryItem } from './telemetry.validation.js';
import { AppError } from '../../shared/http/errors.js';
import { pushStellarAnchorJob, pushAlertJob } from '../../infra/redis/queue.js';
import { invalidateShipmentEtaCache } from '../shipments/shipmentsEta.cache.js';

/**
 * Finds the active (IN_TRANSIT) shipment linked to a given sensorId.
 * The sensorId is stored in offChainMetadata.sensorId on the Shipment document.
 */
export async function findActiveShipmentBySensorId(sensorId: string) {
  return Shipment.findOne({
    'offChainMetadata.sensorId': sensorId,
    status: ShipmentStatus.IN_TRANSIT,
  }).lean();
}

export async function createTelemetryRecord(input: {
  sensorId?: string;
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
    sensorId: input.sensorId ?? input.shipmentId,
    shipmentId: input.shipmentId,
    temperature: input.temperature,
    humidity: input.humidity,
    latitude: input.latitude,
    longitude: input.longitude,
    batteryLevel: input.batteryLevel,
    timestamp: input.timestamp,
    dataHash: input.dataHash,
    stellarTxHash: input.stellarTxHash,
    anchorStatus: input.anchorStatus ?? TelemetryAnchorStatus.PENDING_ANCHOR,
    rawPayload: input.rawPayload,
  });
}

export async function updateTelemetryAnchor(telemetryId: string, stellarTxHash: string) {
  return Telemetry.findByIdAndUpdate(
    telemetryId,
    { stellarTxHash, anchorStatus: TelemetryAnchorStatus.ANCHORED },
    { new: true }
  );
}

export async function markTelemetryAnchorFailed(telemetryId: string, error: string) {
  return Telemetry.findByIdAndUpdate(
    telemetryId,
    { anchorStatus: TelemetryAnchorStatus.ANCHOR_FAILED, anchorError: error },
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

export async function bulkIngestTelemetry(items: BulkTelemetryItem[]) {
  const createdIds: string[] = [];

  for (const item of items) {
    let shipmentId = item.shipmentId;
    if (!shipmentId && item.sensorId) {
      const shipment = await findActiveShipmentBySensorId(item.sensorId);
      if (!shipment?._id) {
        throw new AppError(
          404,
          `No active shipment found for sensor ${item.sensorId}`,
          'NOT_FOUND'
        );
      }
      shipmentId = shipment._id.toString();
    }

    if (!shipmentId) {
      throw new AppError(400, 'shipmentId could not be resolved', 'BAD_REQUEST');
    }

    const dataHash = generateDataHash(item as unknown);

    const telemetry = await createTelemetryRecord({
      sensorId: item.sensorId,
      shipmentId,
      temperature: item.temperature,
      humidity: item.humidity,
      latitude: item.latitude,
      longitude: item.longitude,
      batteryLevel: item.batteryLevel ?? 100,
      timestamp: item.timestamp,
      dataHash,
      anchorStatus: TelemetryAnchorStatus.PENDING_ANCHOR,
      rawPayload: item,
    });

    createdIds.push(telemetry._id.toString());
    await invalidateShipmentEtaCache(shipmentId);

    await pushStellarAnchorJob({
      telemetryId: telemetry._id.toString(),
      shipmentId,
      dataHash,
    });

    const telemetryPayload: TelemetryUpdatePayload = {
      telemetryId: telemetry._id.toString(),
      shipmentId: telemetry.shipmentId.toString(),
      sensorId: telemetry.sensorId ?? item.sensorId ?? shipmentId,
      temperature: telemetry.temperature,
      humidity: telemetry.humidity,
      latitude: telemetry.latitude,
      longitude: telemetry.longitude,
      batteryLevel: telemetry.batteryLevel,
      timestamp: telemetry.timestamp.toISOString(),
      dataHash: telemetry.dataHash,
      anchorStatus: telemetry.anchorStatus as 'PENDING_ANCHOR' | 'ANCHORED' | 'ANCHOR_FAILED',
      ...(telemetry.stellarTxHash && { stellarTxHash: telemetry.stellarTxHash }),
    };

    emitTelemetryUpdate(shipmentId, telemetryPayload);

    setImmediate(async () => {
      const result = await detectAnomaly({
        _id: telemetry._id.toString(),
        shipmentId: telemetry.shipmentId.toString(),
        temperature: telemetry.temperature,
        humidity: telemetry.humidity,
        batteryLevel: telemetry.batteryLevel,
        timestamp: telemetry.timestamp,
      });

      if (result.detected) {
        await Promise.all(
          result.anomalies.map(async anomaly => {
            const anomalyPayload: AnomalyAlertPayload = {
              anomalyId: anomaly._id,
              shipmentId: anomaly.shipmentId,
              type: anomaly.type as
                | 'TEMPERATURE_EXCEEDED'
                | 'TEMPERATURE_BELOW_MIN'
                | 'HUMIDITY_EXCEEDED'
                | 'HUMIDITY_BELOW_MIN'
                | 'BATTERY_LOW',
              severity: anomaly.severity as 'LOW' | 'MEDIUM' | 'HIGH',
              message: anomaly.message,
              timestamp: anomaly.timestamp,
              resolved: anomaly.resolved,
            };

            emitAnomalyDetected(anomaly.shipmentId, anomalyPayload);
            await pushAlertJob({
              shipmentId: anomaly.shipmentId,
              type: anomaly.type,
              severity: anomaly.severity,
              message: anomaly.message,
            });
          })
        );
      }
    });
  }

  return { insertedCount: createdIds.length, insertedIds: createdIds };
}
