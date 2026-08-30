import { generateDataHash } from '../../shared/utils/crypto.js';
import * as telemetryService from '../telemetry/telemetry.service.js';
import { TelemetryAnchorStatus } from '../telemetry/telemetry.model.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { detectTelemetryAnomalies } from '../../services/telemetryAnomalyDetection.js';
import { emitAnomalyDetected, emitTelemetryUpdate } from '../../infra/socket/io.js';
import { pushAlertJob, pushStellarAnchorJob } from '../../infra/redis/queue.js';
import logger from '../../shared/logger/logger.js';
import type { IotWebhookBody } from './iot.validation.js';
import type {
  AnomalyAlertPayload,
  TelemetryUpdatePayload,
} from '../../shared/types/socketEvents.js';

type NormalizedBody = {
  sensorId?: string;
  shipmentId?: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: Date;
  shockMagnitude?: number;
  gpsLost?: boolean;
  rawPayload: IotWebhookBody;
};

function normalizeIotWebhookBody(body: IotWebhookBody): NormalizedBody {
  if ('shipmentId' in body) {
    return {
      shipmentId: body.shipmentId,
      temperature: body.temperature,
      humidity: body.humidity,
      latitude: body.latitude,
      longitude: body.longitude,
      batteryLevel: body.batteryLevel ?? 100,
      timestamp: body.timestamp,
      shockMagnitude: body.shockMagnitude,
      gpsLost: body.gpsLost,
      rawPayload: body,
    };
  }

  return {
    sensorId: body.sensorId,
    temperature: body.temp,
    humidity: body.humidity,
    latitude: body.location.lat,
    longitude: body.location.lng,
    batteryLevel: body.batteryLevel ?? 100,
    timestamp: body.timestamp,
    shockMagnitude: body.shockMagnitude,
    gpsLost: body.gpsLost,
    rawPayload: body,
  };
}

/**
 * Processes IoT webhook payloads, normalizes the body, stores telemetry, and emits real-time events.
 * Detects anomalies and updates telemetry record with isAnomaly and anomalyType flags.
 *
 * @param {IotWebhookBody} body - Raw webhook payload from the IoT device.
 * @returns {Promise<unknown>} Persisted telemetry document.
 * @throws {AppError} When shipment cannot be resolved for the payload.
 */
export async function processIotWebhook(body: IotWebhookBody) {
  const normalizedBody = normalizeIotWebhookBody(body);

  let shipmentId = normalizedBody.shipmentId;
  if (!shipmentId && normalizedBody.sensorId) {
    const shipment = await telemetryService.findActiveShipmentBySensorId(normalizedBody.sensorId);
    if (!shipment?._id) {
      throw new AppError(
        404,
        `No active shipment found for sensor ${normalizedBody.sensorId}`,
        'NOT_FOUND'
      );
    }
    shipmentId = shipment._id.toString();
  }

  if (!shipmentId) {
    throw new AppError(400, 'shipmentId could not be resolved', ErrorCodes.BAD_REQUEST);
  }

  const dataHash = generateDataHash(normalizedBody.rawPayload);

  const telemetry = await telemetryService.createTelemetryRecord({
    sensorId: normalizedBody.sensorId,
    shipmentId,
    temperature: normalizedBody.temperature,
    humidity: normalizedBody.humidity,
    latitude: normalizedBody.latitude,
    longitude: normalizedBody.longitude,
    batteryLevel: normalizedBody.batteryLevel,
    timestamp: normalizedBody.timestamp,
    dataHash,
    shockMagnitude: normalizedBody.shockMagnitude,
    anchorStatus: TelemetryAnchorStatus.PENDING_ANCHOR,
    rawPayload: normalizedBody.rawPayload,
  });

  await pushStellarAnchorJob({
    telemetryId: telemetry._id.toString(),
    shipmentId,
    dataHash,
  });

  const telemetryPayload: TelemetryUpdatePayload = {
    telemetryId: telemetry._id.toString(),
    shipmentId: telemetry.shipmentId.toString(),
    sensorId: telemetry.sensorId ?? normalizedBody.sensorId ?? shipmentId,
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
      const result = await detectTelemetryAnomalies(
        telemetry._id.toString(),
        telemetry.shipmentId.toString(),
        telemetry.temperature,
        telemetry.humidity,
        telemetry.batteryLevel,
        telemetry.shockMagnitude,
        telemetry.latitude,
        telemetry.longitude
      );

      if (result.isAnomaly && result.anomalyType) {
        const anomalyPayload: AnomalyAlertPayload = {
          anomalyId: telemetry._id.toString(),
          shipmentId: telemetry.shipmentId.toString(),
          type: result.anomalyType as AnomalyAlertPayload['type'],
          severity: 'HIGH',
          message: result.details.join('; '),
          timestamp: new Date().toISOString(),
          resolved: false,
        };

        emitAnomalyDetected(shipmentId, anomalyPayload);
        await pushAlertJob({
          shipmentId: shipmentId,
          type: result.anomalyType,
          severity: 'HIGH',
          message: result.details.join('; '),
        });
      }
    } catch (err) {
      logger.error({ err, shipmentId }, 'Background telemetry anomaly detection failed');
    }
  });

  return telemetry;
}
