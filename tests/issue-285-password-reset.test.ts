import { jest, describe, it, expect, beforeAll } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockBlockToken = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockIsTokenBlocked = jest.fn() as any;

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => {
  const users: Record<string, unknown>[] = [];
  const UserModel = {
    findOne: ({ email }: { email: string }) =>
      Promise.resolve(users.find(u => u.email === email) ?? null),
    findById: (id: string) => {
      const found = users.find(u => u._id === id);
      if (!found) return Promise.resolve(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Promise.resolve({ ...found, save: jest.fn<any>().mockResolvedValue(undefined) });
    },
    _users: users,
  };
  const OrganizationModel = { findById: () => Promise.resolve(null) };
  const UserRole = {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    VIEWER: 'VIEWER',
    CUSTOMER: 'CUSTOMER',
  };
  const OrganizationType = { ENTERPRISE: 'ENTERPRISE', LOGISTICS: 'LOGISTICS' };
  return { UserModel, OrganizationModel, UserRole, OrganizationType };
});

await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
  blockToken: mockBlockToken.mockResolvedValue(undefined),
  isTokenBlocked: mockIsTokenBlocked.mockResolvedValue(false),
  isValidJti: jest.fn<() => boolean>().mockReturnValue(true),
  BLOCKLIST_PREFIX: 'blocklist:uuid:',
}));

await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
}));

const jwt = await import('jsonwebtoken');
const { forgotPassword, resetPassword } = await import('../src/modules/auth/auth.service.js');

describe('#285 - Password Reset Flow', () => {
  const jwtSecret = process.env.JWT_SECRET ?? 'test-secret-key-at-least-32-chars-long';

  beforeAll(() => {
    process.env.JWT_SECRET = jwtSecret;
  });

  describe('forgotPassword', () => {
    it('should return silently for non-existent email (prevents enumeration)', async () => {
      await expect(forgotPassword('nonexistent@test.com')).resolves.toBeUndefined();
    });

    it('should return silently for existing email', async () => {
      const usersModule = await import('../src/modules/users/users.model.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (usersModule.UserModel as any)._users.push({
        _id: 'user1',
        email: 'existing@test.com',
        passwordHash: 'hash',
        role: 'VIEWER',
      });
      await expect(forgotPassword('existing@test.com')).resolves.toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    it('should reject an expired token', async () => {
      const expiredToken = jwt.sign(
        { userId: 'user1', type: 'PASSWORD_RESET', jti: 'test-jti' },
        jwtSecret,
        { expiresIn: -1 }
      );
      await expect(resetPassword(expiredToken, 'newpassword123')).rejects.toMatchObject({
        code: 'ERR_AUTH_INVALID_RESET_TOKEN',
        statusCode: 400,
      });
    });

    it('should reject a token with wrong type', async () => {
      const wrongTypeToken = jwt.sign(
        { userId: 'user1', type: 'ACCESS', jti: 'test-jti-2' },
        jwtSecret,
        { expiresIn: 3600 }
      );
      await expect(resetPassword(wrongTypeToken, 'newpassword123')).rejects.toMatchObject({
        code: 'ERR_AUTH_INVALID_RESET_TOKEN',
        statusCode: 400,
      });
    });

    it('should reject a totally invalid token', async () => {
      await expect(resetPassword('not.a.valid.token', 'newpassword123')).rejects.toMatchObject({
        code: 'ERR_AUTH_INVALID_RESET_TOKEN',
        statusCode: 400,
      });
    });

    it('should reject a token for a non-existent user', async () => {
      const token = jwt.sign(
        { userId: 'nonexistent-user', type: 'PASSWORD_RESET', jti: 'test-jti-3' },
        jwtSecret,
        { expiresIn: 3600 }
      );
      await expect(resetPassword(token, 'newpassword123')).rejects.toMatchObject({
        code: 'ERR_AUTH_INVALID_RESET_TOKEN',
        statusCode: 400,
      });
    });

    it('should successfully reset password for valid token', async () => {
      const usersModule = await import('../src/modules/users/users.model.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (usersModule.UserModel as any)._users.push({
        _id: 'user2',
        email: 'reset@test.com',
        passwordHash: 'oldhash',
        role: 'VIEWER',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        save: jest.fn<any>().mockResolvedValue(undefined),
      });

      const token = jwt.sign(
        { userId: 'user2', type: 'PASSWORD_RESET', jti: 'test-jti-4' },
        jwtSecret,
        { expiresIn: 3600 }
      );
      await expect(resetPassword(token, 'newpassword123')).resolves.toBeUndefined();
    });
  });
});
