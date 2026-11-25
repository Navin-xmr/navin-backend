import express, { Router } from 'express';

import { validateRequest } from '../../shared/validation/validate.js';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireApiKey } from '../../shared/middleware/requireApiKey.js';
import { verifyStellarSignature } from '../../shared/middleware/verifyStellarSignature.js';
import { IotWebhookBodySchema } from './iot.validation.js';
import { iotWebhookController } from './iot.controller.js';
import { StellarWebhookPayloadSchema } from './stellar.webhook.validation.js';
import { handleStellarWebhookController } from './stellar.webhook.controller.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/roles.js';
import {
  ChainWebhookSubscriptionIdSchema,
  CreateChainWebhookSubscriptionSchema,
} from './chainWebhook.validation.js';
import {
  createChainWebhookSubscriptionController,
  listChainWebhookSubscriptionsController,
  revokeChainWebhookSubscriptionController,
} from './chainWebhook.controller.js';

export const webhooksRouter = Router();

webhooksRouter.post(
  '/chain/subscriptions',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ body: CreateChainWebhookSubscriptionSchema }),
  asyncHandler(createChainWebhookSubscriptionController)
);

webhooksRouter.get(
  '/chain/subscriptions',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(listChainWebhookSubscriptionsController)
);

webhooksRouter.delete(
  '/chain/subscriptions/:subscriptionId',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: ChainWebhookSubscriptionIdSchema }),
  asyncHandler(revokeChainWebhookSubscriptionController)
);

webhooksRouter.post(
  '/iot',
  // PUBLIC: IoT device callbacks — authenticated via x-api-key, not JWT
  express.json({ limit: '1mb' }),
  asyncHandler(requireApiKey),
  validateRequest({ body: IotWebhookBodySchema }),
  asyncHandler(iotWebhookController)
);

webhooksRouter.post(
  '/stellar',
  // PUBLIC: Stellar settlement callbacks — authenticated via HMAC signature, not JWT
  asyncHandler(verifyStellarSignature),
  validateRequest({ body: StellarWebhookPayloadSchema }),
  asyncHandler(handleStellarWebhookController)
);
