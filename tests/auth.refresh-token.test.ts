import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { redisMock, signToken } from './fixtures/factories.js';

/** @see issue-#290 */

const redisStore = new Map<string, string>();
await jest.unstable_mockModule('../src/infra/redis/connection.js', () => redisMock(redisStore));
// ─── Issue #290 — Token refresh ──────────────────────────────────────────────

describe('#290 refreshToken service', () => {

  const mockUser = { _id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN', deletedAt: null };
  const mockFindById = jest.fn(async () => mockUser);

  beforeEach(async () => {
    jest.resetModules();
    redisStore.clear();
    mockFindById.mockClear();

    await jest.unstable_mockModule('../src/infra/redis/connection.js', () => redisMock(redisStore));
    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: { findOne: jest.fn(), findById: mockFindById },
      OrganizationModel: { findById: jest.fn() },
      UserRole: { ADMIN: 'ADMIN', VIEWER: 'VIEWER' },
      OrganizationType: {},
    }));
  });

  it('issues a new token and blocklists the old jti', async () => {
    const { refreshToken } = await import('../src/modules/auth/auth.service.js');
    const oldToken = signToken({ userId: 'u1', role: 'ADMIN', jti: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }, { expiresIn: '7d' });
    const result = await refreshToken(oldToken);
    expect(result.token).toBeTruthy();
    expect(result.expiresIn).toBe(7 * 24 * 60 * 60);
    // old jti should be blocklisted
    const blocked = [...redisStore.keys()].some(k => k.includes('aaaaaaaa'));
    expect(blocked).toBe(true);
  });

  it('returns 401 when token is already blocklisted', async () => {
    const { refreshToken } = await import('../src/modules/auth/auth.service.js');
    const jti = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const token = signToken({ userId: 'u1', role: 'ADMIN', jti }, { expiresIn: '7d' });
    redisStore.set(`blocklist:uuid:${jti}`, '1');
    await expect(refreshToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 401 for completely invalid token', async () => {
    const { refreshToken } = await import('../src/modules/auth/auth.service.js');
    await expect(refreshToken('not.a.token')).rejects.toMatchObject({ statusCode: 401 });
  });
});
