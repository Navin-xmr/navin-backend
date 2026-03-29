import type { RequestHandler } from 'express';

import type { IotWebhookBody } from './iot.validation.js';
import { processIotWebhook } from './iot.service.js';

export const iotWebhookController: RequestHandler = async (req, res) => {
  const body = req.body as IotWebhookBody;
  const telemetry = await processIotWebhook(body);

  // Respond immediately with 202 Accepted
  res.status(202).json({
    data: telemetry,
    message: 'Telemetry received and queued for Stellar anchoring',
  });
};
