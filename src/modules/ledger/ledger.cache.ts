/**
 * Short-TTL read cache for chain state endpoints (P14-12).
 *
 * Chain reads use simulation only and are safe to cache briefly. Each cache
 * entry is keyed by endpoint + parameter, with a short TTL so stale reads
 * self-expire. Explicit invalidation is triggered by chain events (escrow
 * deposits, releases, refunds) so the cache never serves stale state after a
 * state-changing on-chain event.
 */
import { getRedisClient } from '../../infra/redis/connection.js';

const CHAIN_READ_CACHE_PREFIX = 'chain:read:';
const CHAIN_READ_CACHE_TTL_SECONDS = 60; // short TTL — cache briefly

let redisUnavailable = false;

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (...args: unknown[]) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
  scan: (...args: unknown[]) => Promise<[string, string[]]>;
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

export function chainReadCacheKey(endpoint: string, param?: string): string {
  return `${CHAIN_READ_CACHE_PREFIX}${endpoint}:${param ?? 'global'}`;
}

export async function readChainReadCache<T>(key: string): Promise<T | null> {
  const client = getCacheClient();
  if (!client) {
    return null;
  }

  try {
    const value = await client.get(key);
    if (!value) {
      return null;
    }
    return JSON.parse(value) as T;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

export async function writeChainReadCache<T>(key: string, payload: T): Promise<void> {
  const client = getCacheClient();
  if (!client) {
    return;
  }

  try {
    await client.set(key, JSON.stringify(payload), 'EX', CHAIN_READ_CACHE_TTL_SECONDS);
  } catch {
    redisUnavailable = true;
  }
}

export async function invalidateChainReadCache(endpoint: string, param?: string): Promise<void> {
  const client = getCacheClient();
  if (!client) {
    return;
  }

  try {
    const key = chainReadCacheKey(endpoint, param);
    await client.del(key);
  } catch {
    redisUnavailable = true;
  }
}

export async function invalidateChainReadCachePrefix(endpoint: string): Promise<void> {
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
        `${CHAIN_READ_CACHE_PREFIX}${endpoint}:*`,
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
