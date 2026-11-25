import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { logger } from '../../shared/logger/logger.js';
import { Shipment } from '../shipments/shipments.model.js';
import { ChainWebhookSubscriptionModel } from './chainWebhook.model.js';
import type { ChainWebhookSubscription } from './chainWebhook.model.js';
import { postChainWebhookRequest } from './chainWebhook.transport.js';
import {
  createChainWebhookSignature,
  decryptChainWebhookSecret,
  encryptChainWebhookSecret,
} from './chainWebhook.crypto.js';
import type {
  ChainWebhookEventName,
  ChainWebhookJobData,
  ChainWebhookPayload,
} from '../../shared/types/chainWebhook.js';
import type { CreateChainWebhookSubscription } from './chainWebhook.validation.js';

interface ChainWebhookSubscriptionCreated {
  id: string;
  endpoint: string;
  events: string[];
  createdAt: Date;
  secret: string;
}

interface ChainWebhookSubscriptionSummary {
  id: string;
  endpoint: string;
  events: string[];
  createdAt: Date;
}

/**
 * Creates an organization-scoped subscription and returns its HMAC secret once.
 *
 * @param input - Validated endpoint and chain event names.
 * @param organizationId - Organization from the authenticated user's token.
 * @param createdBy - Authenticated user ID.
 * @throws {AppError} 503 ERR_WEBHOOKS_ENCRYPTION_KEY_MISSING when encryption is not configured.
 */
export async function createChainWebhookSubscription(
  input: CreateChainWebhookSubscription,
  organizationId: string,
  createdBy: string
): Promise<ChainWebhookSubscriptionCreated> {
  const secret = randomBytes(32).toString('hex');
  const subscription = await ChainWebhookSubscriptionModel.create({
    organizationId: new Types.ObjectId(organizationId),
    endpoint: input.endpoint,
    events: input.events,
    secretEncrypted: encryptChainWebhookSecret(secret),
    createdBy: new Types.ObjectId(createdBy),
  });

  return {
    id: subscription._id.toString(),
    endpoint: subscription.endpoint,
    events: subscription.events,
    createdAt: subscription.createdAt,
    secret,
  };
}

/** Lists active subscriptions without exposing encrypted signing secrets. */
export async function listChainWebhookSubscriptions(
  organizationId: string
): Promise<ChainWebhookSubscriptionSummary[]> {
  const subscriptions = await ChainWebhookSubscriptionModel.find({
    organizationId: new Types.ObjectId(organizationId),
    isActive: true,
  })
    .select('_id endpoint events createdAt')
    .sort({ createdAt: -1 })
    .lean<ChainWebhookSubscription[]>();

  return subscriptions.map(subscription => ({
    id: subscription._id.toString(),
    endpoint: subscription.endpoint,
    events: subscription.events,
    createdAt: subscription.createdAt,
  }));
}

/**
 * Deactivates an organization-owned subscription.
 * @throws {AppError} 404 ERR_NOT_FOUND when the subscription is absent or belongs to another org.
 */
export async function revokeChainWebhookSubscription(
  subscriptionId: string,
  organizationId: string
): Promise<void> {
  const subscription = await ChainWebhookSubscriptionModel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(subscriptionId),
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
    },
    { $set: { isActive: false, deletedAt: new Date() } },
    { new: true }
  );

  if (!subscription) {
    throw new AppError(404, 'Webhook subscription not found', ErrorCodes.NOT_FOUND);
  }
}

/**
 * Queues a confirmed chain event for subscriptions belonging to the shipment's organizations.
 *
 * @param event - Confirmed contract event and shipment identifier.
 * @returns Number of delivery jobs enqueued.
 */
export async function enqueueChainWebhookEvent(event: {
  eventId: string;
  eventName: ChainWebhookEventName;
  shipmentId: string;
  txHash: string;
  ledger: number;
  occurredAt: string;
  dataHash?: string;
}): Promise<number> {
  if (!Types.ObjectId.isValid(event.shipmentId)) {
    logger.warn(
      { eventId: event.eventId, eventName: event.eventName },
      'Webhook shipment ID is not a Mongo ObjectId'
    );
    return 0;
  }
  const shipment = await Shipment.findById(event.shipmentId)
    .select('trackingNumber enterpriseId logisticsId')
    .lean();
  if (!shipment) {
    logger.warn(
      { eventId: event.eventId, shipmentId: event.shipmentId },
      'Webhook shipment was not found'
    );
    return 0;
  }

  const organizationIds = [shipment.enterpriseId, shipment.logisticsId]
    .filter(Types.ObjectId.isValid)
    .map(id => new Types.ObjectId(id));
  const subscriptions = await ChainWebhookSubscriptionModel.find({
    organizationId: { $in: organizationIds },
    events: event.eventName,
    isActive: true,
  })
    .select('_id')
    .lean<Pick<ChainWebhookSubscription, '_id'>[]>();

  const payload: ChainWebhookPayload = {
    eventId: event.eventId,
    eventName: event.eventName,
    shipmentReference: shipment.trackingNumber,
    txHash: event.txHash,
    ledger: event.ledger,
    schemaVersion: 1,
    occurredAt: event.occurredAt,
    ...(event.dataHash && { dataHash: event.dataHash }),
  };
  const { pushChainWebhookJob } = await import('../../infra/redis/queue.js');
  await Promise.all(
    subscriptions.map(subscription =>
      pushChainWebhookJob({
        subscriptionId: subscription._id.toString(),
        eventId: event.eventId,
        payload,
      })
    )
  );
  return subscriptions.length;
}

/**
 * Delivers one job with a timestamped HMAC-SHA256 signature.
 *
 * @param job - Subscription ID and versioned event payload.
 * @throws {AppError} 502 ERR_WEBHOOKS_DELIVERY_FAILED on timeout or non-2xx response.
 * @throws {AppError} 400 ERR_WEBHOOKS_ENDPOINT_NOT_PUBLIC when endpoint DNS resolves privately.
 */
export async function deliverChainWebhook(job: ChainWebhookJobData): Promise<void> {
  const subscription = await ChainWebhookSubscriptionModel.findOne({
    _id: new Types.ObjectId(job.subscriptionId),
    isActive: true,
  })
    .select('+secretEncrypted endpoint')
    .lean<Pick<ChainWebhookSubscription, 'endpoint' | 'secretEncrypted'> | null>();
  if (!subscription) return;

  const body = JSON.stringify(job.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createChainWebhookSignature(
    decryptChainWebhookSecret(subscription.secretEncrypted),
    timestamp,
    body
  );

  let status: number;
  try {
    status = await postChainWebhookRequest(subscription.endpoint, body, {
      'content-type': 'application/json',
      'x-navin-timestamp': timestamp,
      'x-navin-signature': signature,
      'x-navin-event-id': job.eventId,
    });
  } catch (error) {
    logger.warn(
      { subscriptionId: job.subscriptionId, eventName: job.payload.eventName },
      'Chain webhook request failed; BullMQ will retry'
    );
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'Chain webhook request failed', ErrorCodes.WEBHOOKS_DELIVERY_FAILED);
  }

  if (status < 200 || status >= 300) {
    logger.warn(
      { subscriptionId: job.subscriptionId, eventName: job.payload.eventName, status },
      'Chain webhook subscriber returned a non-success status; BullMQ will retry'
    );
    throw new AppError(
      502,
      'Chain webhook subscriber rejected the event',
      ErrorCodes.WEBHOOKS_DELIVERY_FAILED,
      {
        status,
      }
    );
  }
  logger.info(
    {
      subscriptionId: job.subscriptionId,
      eventName: job.payload.eventName,
      txHash: job.payload.txHash,
    },
    'Chain webhook delivered'
  );
}
