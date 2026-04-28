import { getRedisClient } from './connection.js';

const BLOCKLIST_PREFIX = 'jwt:blocklist:';

export async function blockToken(jti: string, ttlSeconds: number): Promise<void> {
  const client = getRedisClient() as import('ioredis').Redis;
  await client.set(`${BLOCKLIST_PREFIX}${jti}`, '1', 'EX', ttlSeconds);
}

export async function isTokenBlocked(jti: string): Promise<boolean> {
  const client = getRedisClient() as import('ioredis').Redis;
  const result = await client.exists(`${BLOCKLIST_PREFIX}${jti}`);
  return result === 1;
}
