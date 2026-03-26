import Redis from 'ioredis';
import { config } from '../../config/index.js';

const RedisCtor = Redis as unknown as new (url: string, options?: unknown) => unknown;
type RedisClient = InstanceType<typeof RedisCtor>;
let redisClient: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  if (!redisClient) {
    redisClient = new RedisCtor(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return redisClient!;
}

export const redisConnection = getRedisClient();