import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { getRedisClient as getSharedRedisClient } from './connection.js';

let redisClient: Redis | null = null;
type TransactionQueueLike = Pick<Queue, 'add' | 'close'>;
let transactionQueue: TransactionQueueLike | null = null;

function isTestEnv(): boolean {
  // See connection.ts — JEST_WORKER_ID survives suites that mutate NODE_ENV.
  return process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    if (isTestEnv()) {
      // Delegate to the shared in-memory client so queue/alert paths never
      // open a real socket in tests.
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

/** Quits queue clients/queues. Safe to call when nothing was created. */
export async function disconnectQueueRedis(): Promise<void> {
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
  const client = getRedisClient();
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
