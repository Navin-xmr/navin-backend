import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { logger } from '../../shared/logger/logger.js';

type RedisCompatible = Redis;

let redisClient: RedisCompatible | null = null;
/** Every client handed out (incl. duplicates) so teardown can quit them all. */
const trackedClients = new Set<{ quit: () => Promise<unknown> }>();

function isTestEnv(): boolean {
  // JEST_WORKER_ID is set by Jest in every test worker and is never mutated
  // by suites — unlike NODE_ENV, which some suites (e.g. swaggerDocs,
  // errorMiddleware) temporarily flip to development/production mid-test.
  // Basing isolation on it guarantees no suite ever opens a real socket.
  return process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
}

// ── In-memory Redis for tests ─────────────────────────────────────────────
// Covers every command the codebase issues (see grep: get/set/setex/del/
// exists/ttl/expire/pttl/incr/decr/scan/pipeline/lpush/ltrim/lindex/rpop/
// lrange/publish/subscribe/unsubscribe/duplicate/quit/disconnect/on).
// Backing stores are module-level so `duplicate()` shares data like real Redis.

const memStrings = new Map<string, { value: string; expireAt: number | null }>();
const memLists = new Map<string, string[]>();

function memIsExpired(expireAt: number | null): boolean {
  return expireAt !== null && Date.now() >= expireAt;
}

function memGetEntry(key: string): { value: string; expireAt: number | null } | undefined {
  const entry = memStrings.get(key);
  if (!entry) return undefined;
  if (memIsExpired(entry.expireAt)) {
    memStrings.delete(key);
    return undefined;
  }
  return entry;
}

function memTtlMs(key: string): number {
  const entry = memStrings.get(key);
  if (!entry) return -2;
  if (entry.expireAt === null) return -1;
  const ms = entry.expireAt - Date.now();
  if (ms <= 0) {
    memStrings.delete(key);
    return -2;
  }
  return ms;
}

function matchGlob(key: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`).test(key);
}

function createInMemoryRedis(): RedisCompatible {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const client = {
    options: { host: 'localhost', port: 6379 } as RedisCompatible['options'],
    async get(key: string): Promise<string | null> {
      return memGetEntry(key)?.value ?? null;
    },
    async set(key: string, value: string, ...args: unknown[]): Promise<'OK'> {
      let expireAt: number | null = null;
      for (let i = 0; i < args.length; i += 1) {
        if ((args[i] === 'EX' || args[i] === 'ex') && typeof args[i + 1] === 'number') {
          expireAt = Date.now() + (args[i + 1] as number) * 1000;
        }
        if ((args[i] === 'PX' || args[i] === 'px') && typeof args[i + 1] === 'number') {
          expireAt = Date.now() + (args[i + 1] as number);
        }
      }
      memStrings.set(key, { value, expireAt });
      return 'OK';
    },
    async setex(key: string, seconds: number, value: string): Promise<'OK'> {
      memStrings.set(key, { value, expireAt: Date.now() + seconds * 1000 });
      return 'OK';
    },
    async del(...keys: string[]): Promise<number> {
      const flat = keys.flat();
      let removed = 0;
      for (const key of flat) {
        if (memStrings.delete(key)) removed += 1;
        if (memLists.delete(key)) removed += 1;
      }
      return removed;
    },
    async exists(...keys: string[]): Promise<number> {
      return keys.flat().filter(k => memGetEntry(k) !== undefined).length;
    },
    async ttl(key: string): Promise<number> {
      const ms = memTtlMs(key);
      if (ms === -2) return -2;
      if (ms === -1) return -1;
      return Math.ceil(ms / 1000);
    },
    async expire(key: string, seconds: number): Promise<number> {
      const entry = memGetEntry(key);
      if (!entry) return 0;
      entry.expireAt = Date.now() + seconds * 1000;
      return 1;
    },
    async pttl(key: string): Promise<number> {
      return memTtlMs(key);
    },
    async incr(key: string): Promise<number> {
      const current = Number(memGetEntry(key)?.value ?? '0');
      const next = (Number.isNaN(current) ? 0 : current) + 1;
      const expireAt = memGetEntry(key)?.expireAt ?? null;
      memStrings.set(key, { value: String(next), expireAt });
      return next;
    },
    async decr(key: string): Promise<number> {
      const current = Number(memGetEntry(key)?.value ?? '0');
      const next = (Number.isNaN(current) ? 0 : current) - 1;
      const expireAt = memGetEntry(key)?.expireAt ?? null;
      memStrings.set(key, { value: String(next), expireAt });
      return next;
    },
    async scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
      let pattern = '*';
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === 'MATCH' && typeof args[i + 1] === 'string') {
          pattern = args[i + 1] as string;
        }
      }
      const keys = [...memStrings.keys(), ...memLists.keys()].filter(k => matchGlob(k, pattern));
      void cursor;
      return ['0', keys];
    },
    async lpush(key: string, ...values: string[]): Promise<number> {
      const list = memLists.get(key) ?? [];
      list.unshift(...values.reverse());
      memLists.set(key, list);
      return list.length;
    },
    async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
      const list = memLists.get(key) ?? [];
      memLists.set(key, list.slice(start, stop + 1));
      return 'OK';
    },
    async lindex(key: string, index: number): Promise<string | null> {
      const list = memLists.get(key) ?? [];
      const at = index < 0 ? list.length + index : index;
      return list[at] ?? null;
    },
    async rpop(key: string): Promise<string | null> {
      const list = memLists.get(key) ?? [];
      const value = list.pop() ?? null;
      memLists.set(key, list);
      return value;
    },
    async lrange(key: string, start: number, stop: number): Promise<string[]> {
      const list = memLists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      return list.slice(start < 0 ? list.length + start : start, end);
    },
    async publish(): Promise<number> {
      return 0;
    },
    async subscribe(): Promise<number> {
      return 0;
    },
    async unsubscribe(): Promise<number> {
      return 0;
    },
    pipeline(): {
      lpush: (...a: unknown[]) => unknown;
      ltrim: (...a: unknown[]) => unknown;
      exec: () => Promise<Array<[null, unknown]>>;
    } {
      const ops: Array<() => Promise<unknown>> = [];
      const pipe = {
        lpush: (...a: unknown[]) => {
          ops.push(() => (client.lpush as (...x: string[]) => Promise<number>)(...(a as string[])));
          return pipe;
        },
        ltrim: (...a: unknown[]) => {
          ops.push(() => (client.ltrim as (...x: never[]) => Promise<'OK'>)(...(a as never[])));
          return pipe;
        },
        exec: async (): Promise<Array<[null, unknown]>> => {
          const results: Array<[null, unknown]> = [];
          for (const op of ops) {
            results.push([null, await op()]);
          }
          return results;
        },
      };
      return pipe;
    },
    duplicate(): RedisCompatible {
      const dup = createInMemoryRedis();
      return dup;
    },
    on(event: string, fn: (...args: unknown[]) => void): unknown {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return client;
    },
    removeAllListeners(event?: string): unknown {
      if (event) listeners.delete(event);
      else listeners.clear();
      return client;
    },
    async quit(): Promise<'OK'> {
      listeners.clear();
      trackedClients.delete(client as unknown as { quit: () => Promise<unknown> });
      if (redisClient === (client as unknown as RedisCompatible)) redisClient = null;
      return 'OK';
    },
    disconnect(): void {
      listeners.clear();
      trackedClients.delete(client as unknown as { quit: () => Promise<unknown> });
      if (redisClient === (client as unknown as RedisCompatible)) redisClient = null;
    },
  };
  trackedClients.add(client as unknown as { quit: () => Promise<unknown> });
  return client as unknown as RedisCompatible;
}

export function getRedisClient(): RedisCompatible {
  if (!redisClient) {
    if (isTestEnv()) {
      redisClient = createInMemoryRedis();
      return redisClient;
    }
    logger.info('Initializing Redis client...');
    redisClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis connection failed, retrying in ${delay}ms... (attempt ${times})`);
        return delay;
      },
    });
    trackedClients.add(redisClient as unknown as { quit: () => Promise<unknown> });

    redisClient.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    redisClient.on('error', err => {
      logger.error(err, 'Redis error');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }
  return redisClient;
}

/** Shared Redis connection for BullMQ workers and queues (lazy — no connect at import time). */
export function getRedisConnection(): RedisCompatible {
  return getRedisClient();
}

/** Returns connection details suitable for BullMQ Worker/Queue constructors. */
export function getBullMQConnection(): { host: string; port: number } {
  if (isTestEnv()) {
    return { host: 'localhost', port: 6379 };
  }
  const client = getRedisClient();
  return {
    host: client.options.host ?? '127.0.0.1',
    port: client.options.port ?? 6379,
  };
}

/** True once a client (real or in-memory) has been created in this process. */
export function isRedisInitialized(): boolean {
  return redisClient !== null || trackedClients.size > 0;
}

/** Clears in-memory test stores. No-op in production. @internal */
export function resetInMemoryRedisForTest(): void {
  if (!isTestEnv()) return;
  memStrings.clear();
  memLists.clear();
}

export async function disconnectRedis(): Promise<void> {
  const clients = [...trackedClients];
  trackedClients.clear();
  redisClient = null;
  for (const client of clients) {
    try {
      await client.quit();
    } catch {
      // Ignore teardown errors — client may already be closed.
    }
  }
}
