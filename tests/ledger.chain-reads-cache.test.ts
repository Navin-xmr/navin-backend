/**
 * Chain read cache tests (P14-12).
 *
 * Tests the short-TTL read cache backed by in-memory Redis:
 *   - key building
 *   - read / write round-trip
 *   - invalidation (single key + prefix scan)
 */
import { describe, expect, it } from '@jest/globals';

describe('chain read cache (P14-12)', () => {
  it('chainReadCacheKey builds scoped keys', async () => {
    const { chainReadCacheKey } = await import('../src/modules/ledger/ledger.cache.js');
    expect(chainReadCacheKey('escrow-balance', 'pay-1')).toBe('chain:read:escrow-balance:pay-1');
    expect(chainReadCacheKey('contract-version')).toBe('chain:read:contract-version:global');
  });

  it('read/write/invalidate round-trip', async () => {
    const { resetInMemoryRedisForTest } = await import('../src/infra/redis/connection.js');

    const {
      readChainReadCache: readCache,
      writeChainReadCache: writeCache,
      invalidateChainReadCache: invalidateCache,
    } = await import('../src/modules/ledger/ledger.cache.js');

    resetInMemoryRedisForTest();

    const key = 'chain:read:test:key';
    const payload = { foo: 'bar' };

    await writeCache(key, payload);
    const read = await readCache<{ foo: string }>(key);
    expect(read).toEqual(payload);

    await invalidateCache('test', 'key');
    const readAfter = await readCache<{ foo: string }>(key);
    expect(readAfter).toBeNull();
  });

  it('invalidateChainReadCachePrefix scans and deletes matching keys', async () => {
    const { resetInMemoryRedisForTest, getRedisClient } =
      await import('../src/infra/redis/connection.js');
    const { invalidateChainReadCachePrefix } =
      await import('../src/modules/ledger/ledger.cache.js');
    resetInMemoryRedisForTest();

    const client = getRedisClient();
    await client.set('chain:read:contract-version:a', '1', 'EX', 60);
    await client.set('chain:read:contract-version:b', '2', 'EX', 60);
    await client.set('chain:read:other:c', '3', 'EX', 60);

    await invalidateChainReadCachePrefix('contract-version');

    expect(await client.get('chain:read:contract-version:a')).toBeNull();
    expect(await client.get('chain:read:contract-version:b')).toBeNull();
    expect(await client.get('chain:read:other:c')).toBe('3');
  });
});
