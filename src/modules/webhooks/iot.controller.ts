import type { RequestHandler } from 'express';

import { generateDataHash } from '../../shared/utils/crypto.js';
import { anchorTelemetryHash } from '../../services/stellar.service.js';
import { createTelemetryRecord } from '../telemetry/telemetry.service.js';
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
};

