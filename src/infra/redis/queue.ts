import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { getRedisClient as getSharedRedisClient } from './connection.js';
import type {
  ChainWebhookDeadLetterData,
  ChainWebhookJobData,
} from '../../shared/types/chainWebhook.js';
import { CHAIN_WEBHOOK_RETRY_POLICY } from '../../shared/types/chainWebhook.js';

let redisClient: Redis | null = null;
type TransactionQueueLike = Pick<Queue, 'add' | 'close'>;
type ChainWebhookQueueLike = Pick<Queue<ChainWebhookJobData>, 'add' | 'close'>;
type ChainWebhookDeadLetterQueueLike = Pick<Queue<ChainWebhookDeadLetterData>, 'add' | 'close'>;
let transactionQueue: TransactionQueueLike | null = null;
let chainWebhookQueue: ChainWebhookQueueLike | null = null;
let chainWebhookDeadLetterQueue: ChainWebhookDeadLetterQueueLike | null = null;

function isTestEnv(): boolean {
  // See connection.ts — JEST_WORKER_ID survives suites that mutate NODE_ENV.
  return process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
}

/**
 * Redis client for the raw list-push paths (`alert_queue`).
 *
 * Deliberately module-private: `connection.ts` owns the single shared, teardown-
 * tracked client, and re-exporting a second `getRedisClient()` from here would
 * give call sites two identically-named accessors (AGENTS.md §8 — no duplicate
 * declarations). In tests it delegates to the shared in-memory client so queue and
 * alert paths never open a real socket.
 */
function getQueueRedisClient(): Redis {
  if (!redisClient) {
    if (isTestEnv()) {
      redisClient = getSharedRedisClient();
      return redisClient;
    }
    redisClient = new Redis(config.redisUrl);
  }
  return redisClient;
}

export function getTransactionQueue(): TransactionQueueLike {
  if (!transactionQueue) {
    if (isTestEnv()) {
      transactionQueue = {
        add: (async () => ({ id: 'test-job-id' })) as unknown as Queue['add'],
        close: (async () => undefined) as unknown as Queue['close'],
      };
      return transactionQueue;
    }
    transactionQueue = new Queue('transaction_queue', {
      connection: {
        host: new URL(config.redisUrl).hostname,
        port: parseInt(new URL(config.redisUrl).port || '6379'),
      },
    }) as TransactionQueueLike;
  }
  return transactionQueue;
}

export function getChainWebhookQueue(): ChainWebhookQueueLike {
  if (!chainWebhookQueue) {
    if (isTestEnv()) {
      chainWebhookQueue = {
        add: (async () => ({
          id: 'test-chain-webhook-job',
        })) as unknown as Queue<ChainWebhookJobData>['add'],
        close: (async () => undefined) as unknown as Queue['close'],
      };
      return chainWebhookQueue;
    }
    chainWebhookQueue = new Queue<ChainWebhookJobData>('chain_webhook_queue', {
      connection: {
        host: new URL(config.redisUrl).hostname,
        port: parseInt(new URL(config.redisUrl).port || '6379'),
      },
    });
  }
  return chainWebhookQueue;
}

function getChainWebhookDeadLetterQueue(): ChainWebhookDeadLetterQueueLike {
  if (!chainWebhookDeadLetterQueue) {
    if (isTestEnv()) {
      chainWebhookDeadLetterQueue = {
        add: (async () => ({
          id: 'test-chain-webhook-dead-letter',
        })) as unknown as Queue<ChainWebhookDeadLetterData>['add'],
        close: (async () => undefined) as unknown as Queue['close'],
      };
      return chainWebhookDeadLetterQueue;
    }
    chainWebhookDeadLetterQueue = new Queue<ChainWebhookDeadLetterData>(
      'chain_webhook_dead_letter_queue',
      {
        connection: {
          host: new URL(config.redisUrl).hostname,
          port: parseInt(new URL(config.redisUrl).port || '6379'),
        },
      }
    );
  }
  return chainWebhookDeadLetterQueue;
}

export async function pushChainWebhookJob(data: ChainWebhookJobData): Promise<void> {
  const eventKey = data.eventId.replace(/[^a-zA-Z0-9_-]/g, '-');
  await getChainWebhookQueue().add('deliver_chain_webhook', data, {
    jobId: `chain-${data.subscriptionId}-${eventKey}`,
    ...CHAIN_WEBHOOK_RETRY_POLICY,
    removeOnComplete: true,
    removeOnFail: false,
  });
}

export async function pushChainWebhookDeadLetter(data: ChainWebhookDeadLetterData): Promise<void> {
  const eventKey = data.job.eventId.replace(/[^a-zA-Z0-9_-]/g, '-');
  await getChainWebhookDeadLetterQueue().add('chain_webhook_dead_letter', data, {
    jobId: `dead-${data.job.subscriptionId}-${eventKey}`,
    removeOnComplete: false,
    removeOnFail: false,
  });
}

/** Quits queue clients/queues. Safe to call when nothing was created. */
export async function disconnectQueueRedis(): Promise<void> {
  for (const queue of [chainWebhookQueue, chainWebhookDeadLetterQueue]) {
    if (queue) {
      try {
        await queue.close();
      } catch {
        // Ignore teardown errors.
      }
    }
  }
  chainWebhookQueue = null;
  chainWebhookDeadLetterQueue = null;
  if (transactionQueue) {
    try {
      await transactionQueue.close();
    } catch {
      // Ignore teardown errors.
    }
    transactionQueue = null;
  }
  if (redisClient && !isTestEnv()) {
    try {
      await redisClient.quit();
    } catch {
      // Ignore teardown errors.
    }
  }
  redisClient = null;
}

export async function pushAlertJob(anomaly: {
  shipmentId: string;
  type: string;
  severity: string;
  message: string;
}) {
  const client = getQueueRedisClient();
  await client.lpush('alert_queue', JSON.stringify(anomaly));
}

export async function pushStellarAnchorJob(data: {
  telemetryId: string;
  shipmentId: string;
  dataHash: string;
}) {
  const queue = getTransactionQueue();
  await queue.add('anchor_telemetry', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  });
}
