import { getRedisClient } from './connection.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

/** Strict UUID v4 prefix for O(1) Redis key lookups during auth checks. */
export const BLOCKLIST_PREFIX = 'blocklist:uuid:';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidJti(jti: string): boolean {
  return UUID_V4_REGEX.test(jti);
}

/**
 * Builds the Redis key for a token identifier.
 *
 * @throws {AppError} `ERR_AUTH_INVALID_TOKEN_IDENTIFIER` when `jti` is not a
 *   UUID v4. Surfacing a registered code lets `errorMiddleware` and clients
 *   branch on the cause instead of matching on message text.
 */
function blocklistKey(jti: string): string {
  if (!isValidJti(jti)) {
    throw new AppError(
      400,
      'Invalid token identifier: expected UUID v4',
      ErrorCodes.TOKEN_INVALID_IDENTIFIER
    );
  }
  return `${BLOCKLIST_PREFIX}${jti.toLowerCase()}`;
}

export async function blockToken(jti: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;

  const client = getRedisClient() as import('ioredis').Redis;
  await client.set(blocklistKey(jti), '1', 'EX', ttlSeconds);
}

export async function isTokenBlocked(jti: string): Promise<boolean> {
  if (!isValidJti(jti)) {
    return false;
  }

  const client = getRedisClient() as import('ioredis').Redis;
  const result = await client.get(blocklistKey(jti));
  return result !== null;
}
