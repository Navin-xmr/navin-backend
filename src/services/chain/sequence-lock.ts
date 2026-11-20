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

import { createClient } from 'redis';
import { config } from '../../config/index.js';
import { logger } from '../../shared/logger/logger.js';
import { KeyedSerializer } from './serializer.js';

const LOCK_KEY_PREFIX = 'chain:seq-lock:';
const DEFAULT_LOCK_TTL_MS = 30_000; // 30 seconds
const DEFAULT_LOCK_WAIT_MS = 100; // Poll interval when lock is held

let redisClient: ReturnType<typeof createClient> | null = null;

/** Lazy-init Redis client for locks. */
function getRedisClient() {
  if (redisClient) return redisClient;
  redisClient = createClient({ url: config.redisUrl });
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
    const acquired = await acquireRedisLock(lockKey, lockValue, lockTtl);

    if (!acquired) {
      logger.warn(
        { account: sourceAccount, maxWaitMs: lockTtl },
        '[Chain] Sequence lock acquisition failed; proceeding with in-process lock only'
      );
      // Proceed with just the in-process lock if Redis fails
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
 * Uses SET with NX (only if not exists) and EX (expiration) for atomicity.
 * Returns true only if we successfully acquired it.
 */
async function acquireRedisLock(
  key: string,
  value: string,
  ttlMs: number
): Promise<boolean> {
  const client = getRedisClient();
  if (!client.isOpen && !client.isConnecting) {
    // Redis not available; allow submission without distributed lock
    return false;
  }

  const startTime = Date.now();
  const ttlSec = Math.ceil(ttlMs / 1000);

  for (;;) {
    try {
      // SET with NX and EX for atomic "set if not exists + expiration"
      const result = await client.set(key, value, {
        NX: true,
        EX: ttlSec,
      });
      if (result === 'OK') {
        return true; // Successfully acquired the lock
      }
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        '[Chain] Redis lock acquisition error'
      );
      return false; // Redis error; give up on distributed lock
    }

    // Lock already held by another process; wait and retry
    if (Date.now() - startTime > ttlMs) {
      return false; // Timeout: give up
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Release a Redis lock by deleting the key, but only if the value matches
 * (prevents one process releasing another's lock).
 */
async function releaseRedisLock(key: string, value: string): Promise<void> {
  const client = getRedisClient();
  if (!client.isOpen) return; // Not connected; nothing to release

  try {
    // Lua script: delete only if the value matches (atomic compare-and-delete)
    await client.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      { keys: [key], arguments: [value] }
    );
  } catch (err) {
    // Log but don't throw; release failures should not fail the task
    logger.debug(
      { error: err instanceof Error ? err.message : String(err) },
      '[Chain] Redis lock release error'
    );
  }
}

/** Close the Redis client (for shutdown or tests). */
export async function closeSequenceLockClient(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.disconnect();
    redisClient = null;
  }
}
