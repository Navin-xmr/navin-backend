import { Router } from 'express';

import { validate } from '../../shared/validation/validate.js';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireApiKey } from '../../shared/middleware/requireApiKey.js';
import { IotWebhookBodySchema, IotSensorPayloadSchema } from './iot.validation.js';
import { iotWebhookController, iotSensorController } from './iot.controller.js';

export const webhooksRouter = Router();

webhooksRouter.post(
  '/iot',
  asyncHandler(requireApiKey),
  validate({ body: IotWebhookBodySchema }),
  asyncHandler(iotWebhookController)
);

webhooksRouter.post(
  '/iot/sensor',
  validate({ body: IotSensorPayloadSchema }),
  asyncHandler(iotSensorController)
);

