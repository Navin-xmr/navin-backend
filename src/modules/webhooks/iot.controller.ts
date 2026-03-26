import type { RequestHandler } from 'express';

import { generateDataHash } from '../../shared/utils/crypto.js';
import { createTelemetryRecord } from '../telemetry/telemetry.service.js';
import { TelemetryAnchorStatus } from '../telemetry/telemetry.model.js';
import { detectAnomaly } from '../anomaly/anomaly.service.js';
import { emitAnomalyDetected, emitTelemetryUpdate } from '../../infra/socket/io.js';
import { pushAlertJob, pushStellarAnchorJob } from '../../infra/redis/queue.js';
import type { IotWebhookBody } from './iot.validation.js';

export const iotWebhookController: RequestHandler = async (req, res) => {
  const body = req.body as IotWebhookBody;

  // Generate data hash
  const dataHash = generateDataHash(body);

  // Save telemetry record with PENDING_ANCHOR status
  const telemetry = await createTelemetryRecord({
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

  // Push Stellar anchoring job to background queue
  await pushStellarAnchorJob({
    telemetryId: telemetry._id.toString(),
    shipmentId: body.shipmentId,
    dataHash,
  });

  // Emit telemetry update to the shipment room
  emitTelemetryUpdate(body.shipmentId, telemetry);

  // Respond immediately with 202 Accepted
  res.status(202).json({ 
    data: telemetry,
    message: 'Telemetry received and queued for Stellar anchoring'
  });

  // Process anomaly detection asynchronously
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

