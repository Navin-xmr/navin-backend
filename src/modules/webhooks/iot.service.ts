import { generateDataHash } from '../../shared/utils/crypto.js';
import * as telemetryService from '../telemetry/telemetry.service.js';
import { TelemetryAnchorStatus } from '../telemetry/telemetry.model.js';
import { AppError } from '../../shared/http/errors.js';
import { detectAnomaly } from '../anomaly/anomaly.service.js';
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
    rawPayload: body,
  };
}

/**
 * Processes IoT webhook payloads, normalizes the body, stores telemetry, and emits real-time events.
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
    throw new AppError(400, 'shipmentId could not be resolved', 'BAD_REQUEST');
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
    } catch (err) {
      logger.error({ err, shipmentId }, 'Background anomaly detection failed');
    }
  });

  return telemetry;
}
