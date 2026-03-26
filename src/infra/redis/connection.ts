import Redis from 'ioredis';
import { config } from '../../config/index.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return redisClient;
}

export const redisConnection = getRedisClient();