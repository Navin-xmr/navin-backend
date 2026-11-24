/**
 * Distributed sequence lock for serializing chain submissions per account
 * across multiple backend replicas (#1065).
 *
 * Combines in-process mutex (KeyedSerializer) with Redis lock to serialize
 * sequence acquisition across the cluster. When locked, all submission attempts
 * for the same account go through a single queue — preventing tx_bad_seq errors.
 *
 * Lock semantics:
 * - TTL prevents deadlock if a process crashes (default 30s)
 * - Released on success or failure (never left dangling)
 * - A failed lock acquisition doesn't block the next attempt
 */

import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { logger } from '../../shared/logger/logger.js';
import { KeyedSerializer } from './serializer.js';

const LOCK_KEY_PREFIX = 'chain:seq-lock:';
const DEFAULT_LOCK_TTL_MS = 30_000; // 30 seconds
const DEFAULT_LOCK_WAIT_MS = 100; // Poll interval when lock is held

let redisClient: Redis | null = null;

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
}

/** Lazy-init Redis client for locks (disabled in unit tests to avoid real sockets). */
function getRedisClient(): Redis | null {
  if (isTestEnv()) return null;
  if (redisClient) return redisClient;

  redisClient = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  redisClient.on('error', err => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      '[Chain] Redis sequence lock client error'
    );
  });
  void redisClient.connect().catch(err => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      '[Chain] Failed to connect Redis for sequence locks'
    );
  });
  return redisClient;
}

/** Process-wide: in-process serialization per account. */
const inProcessLock = new KeyedSerializer();

/**
 * Serialize a chain submission (e.g., transaction signing + sending) per source account.
 *
 * Acquires an in-process lock immediately, then tries to acquire a Redis lock (with retries
 * for cluster-wide serialization). Holds both locks during the task execution, releases on
 * success or error (never hangs the caller).
 *
 * @param sourceAccount The public key or account identifier being submitted from
 * @param task The submission task (e.g., load account → build → sign → send)
 * @param options Lock TTL (ms) and wait interval (ms)
 * @returns The task result, or throws if task fails
 * @throws {Error} from the task execution (sequence errors are now prevented)
 */
export async function serializeSubmission<T>(
  sourceAccount: string,
  task: () => Promise<T>,
  options: { lockTtlMs?: number; waitMs?: number } = {}
): Promise<T> {
  const lockTtl = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const waitMs = options.waitMs ?? DEFAULT_LOCK_WAIT_MS;

  // Phase 1: In-process lock (fast path for same-process concurrent calls)
  return inProcessLock.run(sourceAccount, async () => {
    const lockKey = `${LOCK_KEY_PREFIX}${sourceAccount}`;

    // Phase 2: Try to acquire Redis lock (cluster-wide serialization)
    const lockValue = `${Date.now()}-${Math.random()}`;
    const acquired = await acquireRedisLock(lockKey, lockValue, lockTtl, waitMs);

    if (!acquired && !isTestEnv()) {
      logger.warn(
        { account: sourceAccount, maxWaitMs: lockTtl },
        '[Chain] Sequence lock acquisition failed; proceeding with in-process lock only'
      );
    }

    try {
      return await task();
    } finally {
      // Always release Redis lock, even if task failed
      if (acquired) {
        await releaseRedisLock(lockKey, lockValue).catch(err => {
          logger.error(
            { error: err instanceof Error ? err.message : String(err), account: sourceAccount },
            '[Chain] Failed to release sequence lock'
          );
        });
      }
    }
  });
}

/**
 * Try to acquire a Redis lock for the given key, retrying until TTL expires.
 * Uses SET with EX and NX for atomicity.
 * Returns true only if we successfully acquired it.
 */
async function acquireRedisLock(
  key: string,
  value: string,
  ttlMs: number,
  waitMs: number
): Promise<boolean> {
  const client = getRedisClient();
  if (!client || (client.status !== 'ready' && client.status !== 'connecting')) {
    return false;
  }

  const startTime = Date.now();
  const ttlSec = Math.ceil(ttlMs / 1000);

  for (;;) {
    try {
      const result = await client.set(key, value, 'EX', ttlSec, 'NX');
      if (result === 'OK') {
        return true;
      }
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        '[Chain] Redis lock acquisition error'
      );
      return false;
    }

    if (Date.now() - startTime > ttlMs) {
      return false;
    }

    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

/**
 * Release a Redis lock by deleting the key, but only if the value matches
 * (prevents one process releasing another's lock).
 */
async function releaseRedisLock(key: string, value: string): Promise<void> {
  const client = getRedisClient();
  if (!client || client.status !== 'ready') return;

  try {
    await client.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      1,
      key,
      value
    );
  } catch (err) {
    logger.debug(
      { error: err instanceof Error ? err.message : String(err) },
      '[Chain] Redis lock release error'
    );
  }
}

/** Close the Redis client (for shutdown or tests). */
export async function closeSequenceLockClient(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    redisClient = null;
  }
}
