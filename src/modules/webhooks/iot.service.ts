import { generateDataHash } from '../../shared/utils/crypto.js';
import { createTelemetryRecord, findActiveShipmentBySensorId } from '../telemetry/telemetry.service.js';
import { TelemetryAnchorStatus } from '../telemetry/telemetry.model.js';
import { detectAnomaly } from '../anomaly/anomaly.service.js';
import { emitAnomalyDetected, emitTelemetryUpdate } from '../../infra/socket/io.js';
import { pushAlertJob, pushStellarAnchorJob } from '../../infra/redis/queue.js';
import type { IotWebhookBody } from './iot.validation.js';
import { AppError } from '../../shared/http/errors.js';
import type { TelemetryUpdatePayload, AnomalyAlertPayload } from '../../shared/types/socketEvents.js';

export async function processIotWebhook(body: IotWebhookBody) {
  let shipmentId = body.shipmentId;

  if (!shipmentId) {
    const shipment = await findActiveShipmentBySensorId(body.sensorId);
    if (!shipment) {
      throw new AppError(404, `No active shipment found for sensor ${body.sensorId}`, 'SHIPMENT_NOT_FOUND');
    }
    shipmentId = shipment._id.toString();
  }

  const dataHash = generateDataHash(body);

  const telemetry = await createTelemetryRecord({
    sensorId: body.sensorId,
    shipmentId: shipmentId,
    shipmentId: body.shipmentId,
    temperature: body.temperature,
    humidity: body.humidity,
    latitude: body.latitude,
    longitude: body.longitude,
    batteryLevel: body.batteryLevel,
    timestamp: body.timestamp,
    dataHash,
    anchorStatus: TelemetryAnchorStatus.PENDING_ANCHOR,
    rawPayload: body,
  });

  await pushStellarAnchorJob({
    telemetryId: telemetry._id.toString(),
    shipmentId: shipmentId,
    dataHash,
  });

  // Format telemetry payload for socket emission
  const telemetryPayload: TelemetryUpdatePayload = {
    telemetryId: telemetry._id.toString(),
    shipmentId: telemetry.shipmentId.toString(),
    sensorId: telemetry.sensorId,
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

  emitTelemetryUpdate(body.shipmentId, telemetryPayload);

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
          // Format anomaly payload for socket emission
          const anomalyPayload: AnomalyAlertPayload = {
            anomalyId: anomaly._id,
            shipmentId: anomaly.shipmentId,
            type: anomaly.type as 'TEMPERATURE_EXCEEDED' | 'TEMPERATURE_BELOW_MIN' | 'HUMIDITY_EXCEEDED' | 'HUMIDITY_BELOW_MIN' | 'BATTERY_LOW',
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

  return telemetry;
}
