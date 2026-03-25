import Redis from 'ioredis';
import { config } from '../../config/index.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl);
  }
  return redisClient;
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
