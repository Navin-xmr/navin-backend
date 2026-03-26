import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../../config/index.js';

let redisClient: Redis | null = null;
let transactionQueue: Queue | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl);
  }
  return redisClient;
}

export function getTransactionQueue(): Queue {
  if (!transactionQueue) {
    transactionQueue = new Queue('transaction_queue', {
      connection: {
        host: new URL(config.redisUrl).hostname,
        port: parseInt(new URL(config.redisUrl).port || '6379'),
      },
    });
  }
  return transactionQueue;
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
