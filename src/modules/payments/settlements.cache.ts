import { getRedisClient } from '../../infra/redis/connection.js';

const CACHE_PREFIX = 'settlements:summary:';
const CACHE_TTL_SECONDS = 300; // 5 minutes

let redisUnavailable = false;

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (...args: unknown[]) => Promise<unknown>;
};

function getCacheClient(): RedisLike | null {
  if (redisUnavailable) return null;
  try {
    return getRedisClient() as unknown as RedisLike;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

export function settlementSummaryCacheKey(organizationId: string, period: string): string {
  return `${CACHE_PREFIX}${organizationId}:${period}`;
}

export async function readSummaryCache<T>(key: string): Promise<T | null> {
  const client = getCacheClient();
  if (!client) return null;
  try {
    const value = await client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

export async function writeSummaryCache(key: string, payload: unknown): Promise<void> {
  const client = getCacheClient();
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
  } catch {
    redisUnavailable = true;
  }
}
