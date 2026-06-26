import express, { Router } from 'express';

import { validateRequest } from '../../shared/validation/validate.js';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireApiKey } from '../../shared/middleware/requireApiKey.js';
import { verifyStellarSignature } from '../../shared/middleware/verifyStellarSignature.js';
import { IotWebhookBodySchema } from './iot.validation.js';
import { iotWebhookController } from './iot.controller.js';
import { StellarWebhookPayloadSchema } from './stellar.webhook.validation.js';
import { handleStellarWebhookController } from './stellar.webhook.controller.js';

export const webhooksRouter = Router();

webhooksRouter.post(
  '/iot',
  express.json({ limit: '1mb' }),
  asyncHandler(requireApiKey),
  validateRequest({ body: IotWebhookBodySchema }),
  asyncHandler(iotWebhookController)
);

webhooksRouter.post(
  '/stellar',
  express.json({
    limit: '1mb',
    verify: (req: express.Request, _res, buf) => {
      req.rawBody = buf;
    },
  }),
  asyncHandler(verifyStellarSignature),
  validateRequest({ body: StellarWebhookPayloadSchema }),
  asyncHandler(handleStellarWebhookController),
);