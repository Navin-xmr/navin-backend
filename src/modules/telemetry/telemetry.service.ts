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
import logger from '../../shared/logger/logger.js';

/**
 * Finds the active (IN_TRANSIT) shipment linked to a given sensorId.
 * The sensorId is stored in offChainMetadata.sensorId on the Shipment document.
 */
/**
 * Finds the active shipment associated with a sensor ID.
 * @param {string} sensorId - Sensor identifier from IoT telemetry.
 * @returns {Promise<unknown>} Active shipment document or null.
 */
export async function findActiveShipmentBySensorId(sensorId: string) {
  return Shipment.findOne({
    'offChainMetadata.sensorId': sensorId,
    status: ShipmentStatus.IN_TRANSIT,
  }).lean();
}

/**
 * Persists a telemetry record to the database.
 * @param {object} input - Telemetry record payload.
 * @param {string=} input.sensorId - Optional sensor identifier.
 * @param {string} input.shipmentId - Shipment associated with the telemetry.
 * @param {number} input.temperature - Temperature reading.
 * @param {number} input.humidity - Humidity reading.
 * @param {number} input.latitude - GPS latitude.
 * @param {number} input.longitude - GPS longitude.
 * @param {number} input.batteryLevel - Battery level percentage.
 * @param {Date} input.timestamp - Reading timestamp.
 * @param {string} input.dataHash - Hash of the telemetry payload.
 * @param {string=} input.stellarTxHash - Optional Stellar transaction hash.
 * @param {string=} input.anchorStatus - Telemetry anchor status.
 * @param {unknown} input.rawPayload - Original payload from the source.
 * @returns {Promise<unknown>} Persisted telemetry document.
 */
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

/**
 * Marks a telemetry record as anchored on Stellar.
 * @param {string} telemetryId - Telemetry document ObjectId.
 * @param {string} stellarTxHash - Stellar transaction hash.
 * @returns {Promise<unknown>} Updated telemetry document.
 */
export async function updateTelemetryAnchor(telemetryId: string, stellarTxHash: string) {
  return Telemetry.findByIdAndUpdate(
    telemetryId,
    { stellarTxHash, anchorStatus: TelemetryAnchorStatus.ANCHORED },
    { new: true }
  );
}

/**
 * Marks a telemetry record as failed to anchor.
 * @param {string} telemetryId - Telemetry document ObjectId.
 * @param {string} error - Failure reason.
 * @returns {Promise<unknown>} Updated telemetry document.
 */
export async function markTelemetryAnchorFailed(telemetryId: string, error: string) {
  return Telemetry.findByIdAndUpdate(
    telemetryId,
    { anchorStatus: TelemetryAnchorStatus.ANCHOR_FAILED, anchorError: error },
    { new: true }
  );
}

/**
 * Retrieves telemetry records with cursor-based pagination.
 * @param {object} params - Pagination and filter parameters.
 * @param {string=} params.cursor - Optional cursor for paging.
 * @param {number} params.limit - Maximum number of records to return.
 * @param {string=} params.shipmentId - Optional shipment filter.
 * @returns {Promise<{data: unknown[]; nextCursor: string | null; hasMore: boolean}>} Paginated telemetry results.
 */
export async function getTelemetryService(params: {
  cursor?: string;
  page?: number;
  limit: number;
  shipmentId?: string;
  organizationId?: string;
}) {
  const { cursor, limit, shipmentId, organizationId } = params;
  const query: FilterQuery<unknown> = {};

  if (shipmentId) query.shipmentId = shipmentId;

  const timestampFilter: { $gte?: Date; $lte?: Date } = {};
  if (from) timestampFilter.$gte = from;
  if (to) timestampFilter.$lte = to;
  if (from || to) query.timestamp = timestampFilter;

  if (cursor) query._id = { $lt: cursor };
  if (organizationId) {
    // Find shipments belonging to the user's organization and filter telemetry by those shipment IDs
    const shipments = await Shipment.find({ organizationId }).select('_id').lean();
    const shipmentIds = shipments.map((s: any) => s._id);
    if (shipmentIds.length > 0) {
      query.shipmentId = { $in: shipmentIds };
    } else {
      // No shipments for this organization, return empty result early
      return { data: [], nextCursor: null, hasMore: false };
    }
  }

  const telemetryQuery = Telemetry.find(query)
    .select('-__v -rawPayload')
    .sort({ timestamp: -1, _id: -1 });

  if (page) {
    const skip = (page - 1) * limit;
    telemetryQuery.skip(skip).limit(limit + 1);
  } else {
    telemetryQuery.limit(limit + 1);
  }

  const telemetry = await telemetryQuery.lean();

  const hasMore = telemetry.length > limit;
  const data = hasMore ? telemetry.slice(0, limit) : telemetry;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]._id.toString() : null;

  return { data, nextCursor, hasMore };
}

/**
 * Ingests multiple telemetry items in bulk and schedules downstream processing.
 * @param {BulkTelemetryItem[]} items - List of telemetry payloads to ingest.
 * @returns {Promise<{insertedCount: number; insertedIds: string[]}>} Summary of inserted telemetry documents.
 * @throws {AppError} When a matching active shipment cannot be resolved.
 */
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
      try {
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
            result.anomalies.map(async (anomaly) => {
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
      } catch (err) {
        logger.error({ err, shipmentId }, 'Background anomaly detection failed');
      }
    });  }

  return { insertedCount: createdIds.length, insertedIds: createdIds };
}
