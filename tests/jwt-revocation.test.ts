import { isTokenBlocked, blockToken } from '../src/infra/redis/tokenBlocklist.js';
import { getRedisClient } from '../src/infra/redis/connection.js';

// Mock ioredis
jest.mock('../src/infra/redis/connection.js', () => {
  const store = new Map<string, string>();
  const mockClient = {
    set: jest.fn(async (key: string, value: string, _ex: string, ttl: number) => {
      store.set(key, value);
      // auto-expire simulation not needed for unit tests
      return 'OK';
    }),
    exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    _store: store,
  };
  return {
    getRedisClient: () => mockClient,
    redisConnection: mockClient,
  };
});

describe('Token Blocklist', () => {
  it('returns false for a token not in the blocklist', async () => {
    expect(await isTokenBlocked('unknown-jti')).toBe(false);
  });

  it('returns true after blocking a token', async () => {
    await blockToken('test-jti-123', 3600);
    expect(await isTokenBlocked('test-jti-123')).toBe(true);
  });
});
