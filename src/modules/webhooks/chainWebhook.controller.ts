import type { Request, RequestHandler } from 'express';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import {
  createChainWebhookSubscription,
  listChainWebhookSubscriptions,
  revokeChainWebhookSubscription,
} from './chainWebhook.service.js';
import type { CreateChainWebhookSubscription } from './chainWebhook.validation.js';

function getOrganizationId(request: Request): string {
  const organizationId = request.user?.organizationId;
  if (!organizationId) {
    throw new AppError(403, 'User must belong to an organization', ErrorCodes.FORBIDDEN);
  }
  return organizationId;
}

function getUserId(request: Request): string {
  const userId = request.user?.userId;
  if (!userId) {
    throw new AppError(401, 'Authenticated user ID is missing', ErrorCodes.UNAUTHORIZED);
  }
  return userId;
}

/** Creates an organization-scoped webhook and returns its signing secret once. */
export const createChainWebhookSubscriptionController: RequestHandler = async (req, res) => {
  const input = req.body as CreateChainWebhookSubscription;
  const result = await createChainWebhookSubscription(
    input,
    getOrganizationId(req),
    getUserId(req)
  );
  sendResponse(
    res,
    201,
    true,
    'Chain webhook subscription created. Save the signing secret; it will not be shown again.',
    result
  );
};

/** Lists active webhook subscriptions without returning secrets. */
export const listChainWebhookSubscriptionsController: RequestHandler = async (req, res) => {
  const subscriptions = await listChainWebhookSubscriptions(getOrganizationId(req));
  sendResponse(res, 200, true, 'Chain webhook subscriptions retrieved', subscriptions);
};

/** Deactivates an organization-owned webhook subscription. */
export const revokeChainWebhookSubscriptionController: RequestHandler = async (req, res) => {
  await revokeChainWebhookSubscription(req.params.subscriptionId, getOrganizationId(req));
  sendResponse(res, 200, true, 'Chain webhook subscription revoked', null);
};
