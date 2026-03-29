import type { RequestHandler } from 'express';

import { AppError } from '../../shared/http/errors.js';
import { generateDataHash } from '../../shared/utils/crypto.js';
import { createTelemetryRecord, findActiveShipmentBySensorId } from '../telemetry/telemetry.service.js';
import { TelemetryAnchorStatus } from '../telemetry/telemetry.model.js';
import { detectAnomaly } from '../anomaly/anomaly.service.js';
import { emitAnomalyDetected, emitTelemetryUpdate } from '../../infra/socket/io.js';
import { pushAlertJob, pushStellarAnchorJob } from '../../infra/redis/queue.js';
import type { IotWebhookBody } from './iot.validation.js';

export const iotWebhookController: RequestHandler = async (req, res) => {
  const body = req.body as IotWebhookBody;

  // Resolve active shipment from sensorId
  const shipment = await findActiveShipmentBySensorId(body.sensorId);
  if (!shipment) {
    throw new AppError(404, `No active shipment found for sensorId: ${body.sensorId}`);
  }

  const shipmentId = shipment._id.toString();

  const dataHash = generateDataHash(body);

  const telemetry = await createTelemetryRecord({
    sensorId: body.sensorId,
    shipmentId,
    temperature: body.temp,
    humidity: body.humidity,
    latitude: body.location.lat,
    longitude: body.location.lng,
    timestamp: body.timestamp,
    dataHash,
    anchorStatus: TelemetryAnchorStatus.PENDING_ANCHOR,
    rawPayload: body,
  });

  await pushStellarAnchorJob({
    telemetryId: telemetry._id.toString(),
    shipmentId,
    dataHash,
  });

  emitTelemetryUpdate(shipmentId, telemetry);

  res.status(202).json({
    data: telemetry,
    message: 'Telemetry received and queued for Stellar anchoring',
  });

  // Anomaly detection runs after response is sent
  setImmediate(async () => {
    const result = await detectAnomaly({
      _id: telemetry._id.toString(),
      shipmentId,
      temperature: telemetry.temperature,
      humidity: telemetry.humidity,
      batteryLevel: telemetry.batteryLevel,
      timestamp: telemetry.timestamp,
    });

    if (result.detected) {
      await Promise.all(
        result.anomalies.map(async anomaly => {
          emitAnomalyDetected(anomaly.shipmentId, anomaly);
          await pushAlertJob({
            shipmentId: anomaly.shipmentId,
            type: anomaly.type,
            severity: anomaly.severity,
            message: anomaly.message,
          });
        }),
      );
    }
  });
};
