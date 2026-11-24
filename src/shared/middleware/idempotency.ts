import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { getRedisClient } from '../../infra/redis/connection.js';
import { AppError, ErrorCodes } from '../http/errors.js';
import { logger } from '../logger/logger.js';

/** Header clients send to make a chain-mutating request safe to retry (#1061). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
/** Default retention for stored results. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
/** Upper bound on how long an in-flight claim blocks duplicates if the process dies. */
const IN_FLIGHT_TTL_SECONDS = 120;

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

interface StoredEntry {
  state: 'in_flight' | 'completed';
  fingerprint: string;
  statusCode?: number;
  body?: unknown;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Idempotency for chain-mutating endpoints.
 *
 * - No header → request passes through untouched (opt-in).
 * - Keys are scoped per organization (falling back to user) and per method+route, and expire
 *   after `ttlSeconds`.
 * - The first request atomically claims the key (`SET NX`); concurrent duplicates get 409 while
 *   it is in flight, and once it completes the stored status/body is replayed verbatim with
 *   `Idempotent-Replay: true` — the handler (and therefore the chain submission) never runs twice.
 * - Reusing a key with a different body is rejected (422).
 * - 5xx results are not stored: the claim is released so the client can retry.
 *
 * Mount after `requireAuth` so the scope is known.
 */
export function idempotency(ttlSeconds: number = IDEMPOTENCY_TTL_SECONDS): RequestHandler {
  return async (req, res, next) => {
    const raw = req.header(IDEMPOTENCY_HEADER);
    if (raw === undefined) return next();

    if (!KEY_PATTERN.test(raw)) {
      return next(
        new AppError(
          400,
          `${IDEMPOTENCY_HEADER} must be 8-128 characters of [A-Za-z0-9_-:.]`,
          ErrorCodes.VALIDATION_ERROR
        )
      );
    }

    const scope = req.user?.organizationId || req.user?.userId;
    if (!scope) {
      return next(new AppError(401, 'Authentication required', ErrorCodes.UNAUTHORIZED));
    }

    const route = `${req.method}:${req.baseUrl}${req.route?.path ?? req.path}`;
    const storeKey = `idem:${sha256(`${scope}|${route}|${raw}`)}`;
    const fingerprint = sha256(JSON.stringify(req.body ?? {}));
    const redis = getRedisClient();

    try {
      const claim: StoredEntry = { state: 'in_flight', fingerprint };
      const claimed = await redis.set(
        storeKey,
        JSON.stringify(claim),
        'EX',
        IN_FLIGHT_TTL_SECONDS,
        'NX'
      );

      if (claimed !== 'OK') {
        const existing = await redis.get(storeKey);
        const entry = existing ? (JSON.parse(existing) as StoredEntry) : undefined;
        if (!entry) {
          // Expired or released between SET and GET — let the client retry.
          return next(
            new AppError(
              409,
              'Request with this Idempotency-Key is being processed',
              ErrorCodes.IDEMPOTENCY_IN_PROGRESS
            )
          );
        }
        if (entry.fingerprint !== fingerprint) {
          return next(
            new AppError(
              422,
              'Idempotency-Key was already used with a different request body',
              ErrorCodes.IDEMPOTENCY_KEY_REUSED
            )
          );
        }
        if (entry.state === 'in_flight') {
          return next(
            new AppError(
              409,
              'Request with this Idempotency-Key is being processed',
              ErrorCodes.IDEMPOTENCY_IN_PROGRESS
            )
          );
        }
        res.setHeader('Idempotent-Replay', 'true');
        res.status(entry.statusCode ?? 200).json(entry.body);
        return;
      }
    } catch (err) {
      // Fail closed: running a chain mutation without dedupe is worse than an error.
      logger.error({ err }, 'Idempotency store unavailable');
      return next(new AppError(503, 'Idempotency store unavailable', ErrorCodes.INTERNAL_ERROR));
    }

    let captured: unknown;
    const originalJson = res.json.bind(res);
    res.json = (body?: unknown) => {
      captured = body;
      return originalJson(body);
    };

    let settled = false;
    const settle = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      try {
        if (res.statusCode >= 500 || !res.writableFinished) {
          await redis.del(storeKey);
          return;
        }
        const done: StoredEntry = {
          state: 'completed',
          fingerprint,
          statusCode: res.statusCode,
          body: captured,
        };
        await redis.set(storeKey, JSON.stringify(done), 'EX', ttlSeconds);
      } catch (err) {
        logger.error({ err }, 'Failed to persist idempotent result');
      }
    };
    res.on('finish', () => void settle());
    res.on('close', () => void settle());

    next();
  };
}
