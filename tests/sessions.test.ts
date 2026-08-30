/**
 * Tests for session list and revocation endpoints.
 *
 * Covers:
 *  - GET /api/auth/sessions → 200 with session list after login
 *  - DELETE /api/auth/sessions/:jti → 200 revocation
 *  - DELETE /api/auth/sessions/:jti → 403 cross-user revocation
 *  - Using a revoked token → 401
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

// ---------------------------------------------------------------------------
// Redis mock — shared across all modules imported below
// ---------------------------------------------------------------------------
const redisStore = new Map<string, string>();
const mockRedisGet = jest.fn(async (key: string) => redisStore.get(key) ?? null);
const mockRedisSet = jest.fn(
  async (key: string, value: string, _ex?: string, _ttl?: number) => {
    redisStore.set(key, value);
    return 'OK';
  }
);

await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
  getRedisClient: () => ({ get: mockRedisGet, set: mockRedisSet }),
  getRedisConnection: () => ({ get: mockRedisGet, set: mockRedisSet }),
  disconnectRedis: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Session model mock
// ---------------------------------------------------------------------------
type SessionDoc = {
  _id: string;
  userId: string;
  jti: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  lastUsedAt: Date;
};

const sessionStore = new Map<string, SessionDoc>();

const mockSessionCreate = jest.fn(async (doc: Partial<SessionDoc>) => {
  const id = new Types.ObjectId().toString();
  const now = new Date();
  const session: SessionDoc = {
    _id: id,
    userId: doc.userId!,
    jti: doc.jti!,
    ip: doc.ip,
    userAgent: doc.userAgent,
    createdAt: now,
    lastUsedAt: now,
  };
  sessionStore.set(doc.jti!, session);
  return session;
});

const mockSessionFind = jest.fn((query: Record<string, unknown>) => ({
  sort: () => ({
    select: () => ({
      lean: async () => {
        const userId = query.userId as string;
        return Array.from(sessionStore.values()).filter(
          s => s.userId.toString() === userId.toString()
        );
      },
    }),
  }),
}));

const mockSessionFindOne = jest.fn(async (query: Record<string, unknown>) => {
  return sessionStore.get(query.jti as string) ?? null;
});

const mockSessionDeleteOne = jest.fn(async (query: Record<string, unknown>) => {
  sessionStore.delete(query.jti as string);
  return { deletedCount: 1 };
});

await jest.unstable_mockModule('../src/modules/auth/session.model.js', () => ({
  SessionModel: {
    create: mockSessionCreate,
    find: mockSessionFind,
    findOne: mockSessionFindOne,
    deleteOne: mockSessionDeleteOne,
  },
}));

// ---------------------------------------------------------------------------
// Users model mock
// ---------------------------------------------------------------------------
type UserDoc = {
  _id: { toString(): string };
  email: string;
  name: string;
  role: string;
  organizationId?: { toString(): string } | null;
  passwordHash?: string;
};

const mockUserFindOne = jest.fn() as jest.MockedFunction<
  (query: Record<string, unknown>) => Promise<UserDoc | null>
>;
const mockUserFindById = jest.fn() as jest.MockedFunction<
  (id: string) => Promise<UserDoc | null>
>;
const mockOrgFindById = jest.fn(async () => null);

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    create: jest.fn(),
    findOne: mockUserFindOne,
    findById: mockUserFindById,
  },
  OrganizationModel: { findById: mockOrgFindById },
  UserRole: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    DRIVER: 'DRIVER',
    VIEWER: 'VIEWER',
    CUSTOMER: 'CUSTOMER',
  },
  OrganizationType: { ENTERPRISE: 'ENTERPRISE', LOGISTICS: 'LOGISTICS' },
}));

// ---------------------------------------------------------------------------
// Email service mock (login/signup doesn't actually send email but it's
// imported transitively)
// ---------------------------------------------------------------------------
await jest.unstable_mockModule('../src/services/email.service.js', () => ({
  sendEmail: jest.fn(async () => undefined),
  resetPasswordEmailHtml: (link: string) => `<html>${link}</html>`,
  invitationEmailHtml: (link: string) => `<html>${link}</html>`,
}));

// ---------------------------------------------------------------------------
// Dynamic imports (AFTER all mock registrations)
// ---------------------------------------------------------------------------
const { env } = await import('../src/env.js');
const { login } = await import('../src/modules/auth/auth.service.js');
const { listSessions, revokeSession } = await import(
  '../src/modules/auth/session.service.js'
);
const { isTokenBlocked } = await import('../src/infra/redis/tokenBlocklist.js');
const { requireAuth } = await import('../src/shared/middleware/requireAuth.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import bcrypt from 'bcrypt';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../src/shared/http/errors.js';

async function makeUserAndLogin(id = 'user-abc-123') {
  const hashedPassword = await bcrypt.hash('password123', 10);
  const mockUser: UserDoc = {
    _id: { toString: () => id },
    email: `${id}@example.com`,
    name: 'Test User',
    role: 'VIEWER',
    organizationId: null,
    passwordHash: hashedPassword,
  };
  mockUserFindOne.mockResolvedValue(mockUser);

  const result = await login({ email: mockUser.email, password: 'password123' });
  return { result, mockUser };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Session list and revocation', () => {
  beforeEach(() => {
    redisStore.clear();
    sessionStore.clear();
    mockRedisGet.mockClear();
    mockRedisSet.mockClear();
    mockSessionCreate.mockClear();
    mockSessionFind.mockClear();
    mockSessionFindOne.mockClear();
    mockSessionDeleteOne.mockClear();
    mockUserFindOne.mockReset();
    mockUserFindById.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. 200 — session list after login
  // -------------------------------------------------------------------------
  it('returns session list after login', async () => {
    const userId = 'user-list-test';
    const { result } = await makeUserAndLogin(userId);

    expect(result.token).toBeTruthy();
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId, jti: expect.any(String) })
    );

    const sessions = await listSessions(userId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ userId, jti: expect.any(String) });
  });

  // -------------------------------------------------------------------------
  // 2. 200 — successful revocation
  // -------------------------------------------------------------------------
  it('revokes a session: blocklists token and removes session record', async () => {
    const userId = 'user-revoke-test';
    const { result } = await makeUserAndLogin(userId);

    // Extract the jti from the token
    const decoded = jwt.verify(result.token, env.JWT_SECRET) as { jti: string };
    const jti = decoded.jti;

    // Confirm session exists
    expect(await listSessions(userId)).toHaveLength(1);

    await revokeSession(userId, jti);

    // Token should be blocklisted
    expect(await isTokenBlocked(jti)).toBe(true);

    // Session record should be gone
    const afterRevoke = await listSessions(userId);
    expect(afterRevoke).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 3. 403 — cross-user revocation
  // -------------------------------------------------------------------------
  it('throws 403 when revoking another user\'s session', async () => {
    const ownerUserId = 'user-owner-abc';
    const attackerUserId = 'user-attacker-xyz';

    const { result } = await makeUserAndLogin(ownerUserId);
    const decoded = jwt.verify(result.token, env.JWT_SECRET) as { jti: string };
    const jti = decoded.jti;

    await expect(revokeSession(attackerUserId, jti)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ERR_PERMISSION_DENIED',
    });

    // Token must NOT be blocklisted after failed cross-user revocation
    expect(await isTokenBlocked(jti)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. 401 — revoked token rejected by requireAuth
  // -------------------------------------------------------------------------
  it('requireAuth rejects a revoked token with 401', async () => {
    const userId = 'user-revoked-auth-test';
    const { result } = await makeUserAndLogin(userId);
    const token = result.token;
    const decoded = jwt.verify(token, env.JWT_SECRET) as { jti: string };
    const jti = decoded.jti;

    // Revoke the session
    await revokeSession(userId, jti);
    expect(await isTokenBlocked(jti)).toBe(true);

    // Now requireAuth should reject the token
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;
    const res = {} as Response;
    const next = jest.fn() as jest.MockedFunction<NextFunction>;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const error = next.mock.calls[0][0] as AppError;
    expect(error.statusCode).toBe(401);
    // TOKEN_REVOKED is stored as 'ERR_AUTH_TOKEN_REVOKED' in ErrorCodes
    expect(error.code).toBe('TOKEN_REVOKED');
  });

  // -------------------------------------------------------------------------
  // 5. 404 — revoking a non-existent session
  // -------------------------------------------------------------------------
  it('throws 404 when revoking an unknown jti', async () => {
    await expect(revokeSession('some-user', 'non-existent-jti')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
    });
  });
});
