import { getRedisClient } from '../../infra/redis/connection.js';
import type { AnalyticsDashboardPayload } from './analytics.service.js';

const ANALYTICS_CACHE_PREFIX = 'analytics:performance:';
const ANALYTICS_CACHE_TTL_SECONDS = 300;
let redisUnavailable = false;

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (...args: unknown[]) => Promise<unknown>;
  scan: (...args: unknown[]) => Promise<[string, string[]]>;
  del: (...keys: string[]) => Promise<number>;
};

function getCacheClient(): RedisLike | null {
  if (redisUnavailable) {
    return null;
  }

  try {
    return getRedisClient() as unknown as RedisLike;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

export function analyticsPerformanceCacheKey(startDateIso: string, endDateIso: string): string {
  return `${ANALYTICS_CACHE_PREFIX}${startDateIso}:${endDateIso}`;
}

export async function readAnalyticsPerformanceCache(
  key: string
): Promise<AnalyticsDashboardPayload | null> {
  const client = getCacheClient();
  if (!client) {
    return null;
  }

  try {
    const value = await client.get(key);
    if (!value) {
      return null;
    }
    return JSON.parse(value) as AnalyticsDashboardPayload;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

export async function writeAnalyticsPerformanceCache(
  key: string,
  payload: AnalyticsDashboardPayload
): Promise<void> {
  const client = getCacheClient();
  if (!client) {
    return;
  }

  try {
    await client.set(key, JSON.stringify(payload), 'EX', ANALYTICS_CACHE_TTL_SECONDS);
  } catch {
    redisUnavailable = true;
  }
}

export async function invalidateAnalyticsPerformanceCache(): Promise<void> {
  const client = getCacheClient();
  if (!client) {
    return;
  }

  try {
    let cursor = '0';

    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        'MATCH',
        `${ANALYTICS_CACHE_PREFIX}*`,
        'COUNT',
        '100'
      );

      if (keys.length > 0) {
        await client.del(...keys);
      }

      cursor = nextCursor;
    } while (cursor !== '0');
  } catch {
    redisUnavailable = true;
  }
}
