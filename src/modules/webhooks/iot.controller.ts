import type { RequestHandler } from 'express';

import { generateDataHash } from '../../shared/utils/crypto.js';
import { anchorTelemetryHash } from '../../services/stellar.service.js';
import { createTelemetryRecord } from '../telemetry/telemetry.service.js';
import { detectAnomaly } from '../anomaly/anomaly.service.js';
import { emitAnomalyDetected } from '../../infra/socket/io.js';
import { pushAlertJob } from '../../infra/redis/queue.js';
import type { IotWebhookBody } from './iot.validation.js';

export const iotWebhookController: RequestHandler = async (req, res) => {
  const body = req.body as IotWebhookBody;

  const dataHash = generateDataHash(body);
  const { stellarTxHash } = await anchorTelemetryHash({
    shipmentId: body.shipmentId,
    dataHash,
  });

  const telemetry = await createTelemetryRecord({
    shipmentId: body.shipmentId,
    temperature: body.temperature,
    humidity: body.humidity,
    latitude: body.latitude,
    longitude: body.longitude,
    batteryLevel: body.batteryLevel,
    timestamp: body.timestamp,
    dataHash,
    stellarTxHash,
    rawPayload: body,
  });

  res.status(201).json({ data: telemetry });

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

