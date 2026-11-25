import { CHAIN_EVENT_NAMES } from './chain.js';

export const CHAIN_WEBHOOK_RETRY_POLICY = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 1000 },
} as const;

export type ChainWebhookEventName = (typeof CHAIN_EVENT_NAMES)[keyof typeof CHAIN_EVENT_NAMES];

export interface ChainWebhookPayload {
  eventId: string;
  eventName: ChainWebhookEventName;
  shipmentReference: string;
  txHash: string;
  ledger: number;
  schemaVersion: 1;
  occurredAt: string;
  dataHash?: string;
}

export interface ChainWebhookJobData {
  subscriptionId: string;
  eventId: string;
  payload: ChainWebhookPayload;
}

export interface ChainWebhookDeadLetterData {
  job: ChainWebhookJobData;
  attemptsMade: number;
  errorMessage: string;
  failedAt: string;
}
