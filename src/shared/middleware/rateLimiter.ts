import rateLimit, { type Store, type IncrementResponse } from 'express-rate-limit'; // v8+ bundles its own TypeScript declarations
import type { Request, Response } from 'express';
import { sendResponse } from '../http/sendResponse.js';
import { logger } from '../logger/logger.js';

const isDev = process.env.NODE_ENV !== 'production';

// ── Redis store ──────────────────────────────────────────────────────────────
// Implements the express-rate-limit Store interface backed by the project's
// existing ioredis connection. Falls back to an in-memory map when Redis is
// unavailable so rate limiting still works in test / offline environments.

type RedisLike = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  decr: (key: string) => Promise<number>;
  del: (key: string) => Promise<number>;
  pttl: (key: string) => Promise<number>;
};

// In-memory fallback — used when Redis is unreachable
interface FallbackEntry {
  hits: number;
  resetTime: Date;
}

function tryGetRedis(): RedisLike | null {
  try {
    // Dynamic import via module resolution — works in ESM because we import
    // the already-resolved module cache reference at call time.

    const mod = require('../../infra/redis/connection.js') as {
      getRedisClient?: () => RedisLike;
    };
    return mod.getRedisClient?.() ?? null;
  } catch {
    return null;
  }
}

class RedisRateLimitStore implements Store {
  private windowMs: number;
  private _keyPrefix: string;
  private _redis: RedisLike | null = null;
  private _redisChecked = false;
  private _fallback = new Map<string, FallbackEntry>();

  constructor(windowMs: number, prefix: string = 'rl:') {
    this.windowMs = windowMs;
    this._keyPrefix = prefix;
  }

  private getRedis(): RedisLike | null {
    if (!this._redisChecked) {
      this._redis = tryGetRedis();
      this._redisChecked = true;
    }
    return this._redis;
  }

  private redisKey(key: string): string {
    return `${this._keyPrefix}${key}`;
  }

  // ── In-memory fallback ──────────────────────────────────────────────────
  private incrementFallback(key: string): IncrementResponse {
    const now = Date.now();
    const entry = this._fallback.get(key);

    if (!entry || entry.resetTime.getTime() <= now) {
      const resetTime = new Date(now + this.windowMs);
      this._fallback.set(key, { hits: 1, resetTime });
      return { totalHits: 1, resetTime };
    }

    entry.hits += 1;
    return { totalHits: entry.hits, resetTime: entry.resetTime };
  }

  private decrementFallback(key: string): void {
    const entry = this._fallback.get(key);
    if (entry && entry.hits > 0) entry.hits -= 1;
  }

  private resetFallback(key: string): void {
    this._fallback.delete(key);
  }

  // ── Store interface ──────────────────────────────────────────────────────
  async increment(key: string): Promise<IncrementResponse> {
    const client = this.getRedis();
    if (!client) return this.incrementFallback(key);

    try {
      const redisKey = this.redisKey(key);
      const totalHits = await client.incr(redisKey);

      if (totalHits === 1) {
        await client.expire(redisKey, Math.ceil(this.windowMs / 1000));
      }

      const ttlMs = await client.pttl(redisKey);
      const resetTime = new Date(Date.now() + (ttlMs > 0 ? ttlMs : this.windowMs));

      return { totalHits, resetTime };
    } catch (err) {
      logger.warn({ err }, 'RedisRateLimitStore.increment error — using fallback');
      this._redis = null;
      this._redisChecked = false;
      return this.incrementFallback(key);
    }
  }

  async decrement(key: string): Promise<void> {
    const client = this.getRedis();
    if (!client) {
      this.decrementFallback(key);
      return;
    }
    try {
      await client.decr(this.redisKey(key));
    } catch (err) {
      logger.warn({ err }, 'RedisRateLimitStore.decrement error');
      this.decrementFallback(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    const client = this.getRedis();
    if (!client) {
      this.resetFallback(key);
      return;
    }
    try {
      await client.del(this.redisKey(key));
    } catch (err) {
      logger.warn({ err }, 'RedisRateLimitStore.resetKey error');
      this.resetFallback(key);
    }
  }
}

// ── Handler factory ──────────────────────────────────────────────────────────

const createRateLimitHandler = (message: string) => (req: Request, res: Response) => {
  const rateLimitState = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
  const retryAfter = rateLimitState?.resetTime
    ? Math.max(1, Math.ceil((rateLimitState.resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil(isDev ? 60 : 15 * 60);

  res.setHeader('Retry-After', String(retryAfter));

  sendResponse(res, 429, false, message, null, undefined, { retryAfter });
};

// ── Limiter instances ────────────────────────────────────────────────────────

const standardWindowMs = isDev ? 60 * 1000 : 15 * 60 * 1000;

export const standardLimiter = rateLimit({
  windowMs: standardWindowMs,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore(standardWindowMs, 'rl:standard:'),
  handler: createRateLimitHandler('Too many requests, please try again later.'),
});

const strictWindowMs = 60 * 1000; // 1 minute

export const strictLimiter = rateLimit({
  windowMs: strictWindowMs,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore(strictWindowMs, 'rl:strict:'),
  handler: createRateLimitHandler('Too many requests, please slow down.'),
});

const loginWindowMs = 15 * 60 * 1000; // 15 minutes

export const loginLimiter = rateLimit({
  windowMs: loginWindowMs,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  store: new RedisRateLimitStore(loginWindowMs, 'rl:login:'),
  handler: (req: Request, res: Response) => {
    const rateLimitState = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
    const retryAfter = rateLimitState?.resetTime
      ? Math.max(1, Math.ceil((rateLimitState.resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(15 * 60);

    res.setHeader('Retry-After', String(retryAfter));
    sendResponse(
      res,
      429,
      false,
      'Too many login attempts, please try again later.',
      null,
      undefined,
      {
        retryAfter,
      }
    );
  },
});

/** OTP / password-reset endpoints — tight limit: 5 req/15 min */
const otpWindowMs = 15 * 60 * 1000;

export const otpLimiter = rateLimit({
  windowMs: otpWindowMs,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore(otpWindowMs, 'rl:otp:'),
  handler: createRateLimitHandler('Too many OTP requests, please try again later.'),
});
