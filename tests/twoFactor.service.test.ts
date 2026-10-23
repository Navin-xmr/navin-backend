/**
 * Unit tests for TOTP 2FA service functions.
 *
 * Covers:
 *  - verify2fa: correct code enables 2FA and returns backup codes
 *  - verify2fa: wrong code returns 400
 *  - disable2fa: wrong password returns 401
 *  - consumeBackupCode: code works once, then is invalid
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { AppError } from '../src/shared/http/errors.js';
import bcrypt from 'bcrypt';
import { generateSecret, generateSync } from 'otplib';

// ── Mock dependencies ─────────────────────────────────────────────────────────

// We need mutable user state across calls within a test
let mockUser: Record<string, unknown> | null = null;

const mockFindById = jest.fn();
const mockFindByIdAndUpdate = jest.fn();

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    findById: mockFindById,
    findByIdAndUpdate: mockFindByIdAndUpdate,
  },
  UserRole: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    DRIVER: 'DRIVER',
    VIEWER: 'VIEWER',
    CUSTOMER: 'CUSTOMER',
  },
  OrganizationType: {
    ENTERPRISE: 'ENTERPRISE',
    LOGISTICS: 'LOGISTICS',
  },
}));

// Import service under test AFTER mocks are registered
const {
  setup2fa,
  verify2fa,
  disable2fa,
  regenerateBackupCodes,
  consumeBackupCode,
} = await import('../src/modules/auth/twoFactor.service.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulates findByIdAndUpdate mutating the in-memory user */
function setupMockUser(user: Record<string, unknown>) {
  mockUser = { ...user };

  mockFindById.mockImplementation(() => {
    // Support `.select('+passwordHash')` chaining — just return the user
    const result = mockUser ? { ...mockUser } : null;
    // add a .select() method so Mongoose chaining doesn't explode
    return Object.assign(Promise.resolve(result), {
      select: () => Promise.resolve(result),
    });
  });

  mockFindByIdAndUpdate.mockImplementation((_id: unknown, update: Record<string, unknown>) => {
    if (mockUser) {
      Object.assign(mockUser, update);
    }
    return Promise.resolve(mockUser);
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('setup2fa', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset();
    mockUser = null;
  });

  it('returns otpauthUrl and secret for a user without 2FA', async () => {
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: false,
      totpSecret: null,
      totpBackupCodes: [],
    });

    const result = await setup2fa('user1');

    expect(result).toHaveProperty('otpauthUrl');
    expect(result).toHaveProperty('secret');
    expect(result.otpauthUrl).toContain('otpauth://totp/');
    expect(result.secret.length).toBeGreaterThan(0);
  });

  it('throws 409 when 2FA is already enabled', async () => {
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: true,
      totpSecret: 'EXISTING',
    });

    await expect(setup2fa('user1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ERR_AUTH_2FA_ALREADY_ENABLED',
    });
  });

  it('throws 404 when user is not found', async () => {
    mockFindById.mockReturnValue(Promise.resolve(null));

    await expect(setup2fa('nonexistent')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('verify2fa', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset();
    mockUser = null;
  });

  it('enables 2FA and returns 10 backup codes when code is correct', async () => {
    const secret = generateSecret();
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: false,
      totpSecret: secret,
      totpBackupCodes: [],
    });

    const validCode = generateSync({ secret });
    const result = await verify2fa('user1', validCode);

    expect(result.backupCodes).toHaveLength(10);
    result.backupCodes.forEach(code => {
      expect(typeof code).toBe('string');
      expect(code.length).toBe(10); // 5 bytes → 10 hex chars
    });

    // 2FA should now be enabled in the mock user state
    expect(mockUser?.totpEnabled).toBe(true);
  });

  it('returns 400 when the TOTP code is incorrect', async () => {
    const secret = generateSecret();
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: false,
      totpSecret: secret,
      totpBackupCodes: [],
    });

    await expect(verify2fa('user1', '000000')).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_AUTH_2FA_INVALID_CODE',
    });
  });

  it('returns 400 when no secret has been set up', async () => {
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: false,
      totpSecret: null,
      totpBackupCodes: [],
    });

    await expect(verify2fa('user1', '123456')).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_AUTH_2FA_NOT_SETUP',
    });
  });

  it('returns 409 when 2FA is already enabled', async () => {
    const secret = generateSecret();
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: true,
      totpSecret: secret,
      totpBackupCodes: [],
    });

    const validCode = generateSync({ secret });
    await expect(verify2fa('user1', validCode)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ERR_AUTH_2FA_ALREADY_ENABLED',
    });
  });
});

describe('disable2fa', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset();
    mockUser = null;
  });

  it('disables 2FA when the correct password is provided', async () => {
    const passwordHash = await bcrypt.hash('correctpassword', 10);
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      passwordHash,
      totpEnabled: true,
      totpSecret: 'SOMESECRET',
      totpBackupCodes: ['hash1', 'hash2'],
    });

    await expect(disable2fa('user1', 'correctpassword')).resolves.toBeUndefined();
    expect(mockUser?.totpEnabled).toBe(false);
    expect(mockUser?.totpSecret).toBeNull();
    expect(mockUser?.totpBackupCodes).toEqual([]);
  });

  it('returns 401 when the password is wrong', async () => {
    const passwordHash = await bcrypt.hash('correctpassword', 10);
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      passwordHash,
      totpEnabled: true,
      totpSecret: 'SOMESECRET',
      totpBackupCodes: [],
    });

    await expect(disable2fa('user1', 'wrongpassword')).rejects.toMatchObject({
      statusCode: 401,
      code: 'ERR_AUTH_INVALID',
    });
  });

  it('returns 400 when 2FA is not enabled', async () => {
    const passwordHash = await bcrypt.hash('correctpassword', 10);
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      passwordHash,
      totpEnabled: false,
      totpSecret: null,
      totpBackupCodes: [],
    });

    await expect(disable2fa('user1', 'correctpassword')).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_AUTH_2FA_NOT_ENABLED',
    });
  });
});

describe('regenerateBackupCodes', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset();
    mockUser = null;
  });

  it('returns 10 new backup codes and replaces old ones', async () => {
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: true,
      totpSecret: 'SOMESECRET',
      totpBackupCodes: ['oldhash1', 'oldhash2'],
    });

    const result = await regenerateBackupCodes('user1');

    expect(result.backupCodes).toHaveLength(10);
    result.backupCodes.forEach(code => expect(code.length).toBe(10));

    // Old codes replaced — the stored hashes should be new (10 items)
    expect((mockUser?.totpBackupCodes as string[]).length).toBe(10);
  });

  it('returns 400 when 2FA is not enabled', async () => {
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: false,
      totpSecret: null,
      totpBackupCodes: [],
    });

    await expect(regenerateBackupCodes('user1')).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_AUTH_2FA_NOT_ENABLED',
    });
  });
});

describe('consumeBackupCode', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset();
    mockUser = null;
  });

  it('accepts a valid backup code and marks it as used (removes it)', async () => {
    const plainCode = 'abcdef1234';
    const hash = await bcrypt.hash(plainCode, 10);

    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: true,
      totpBackupCodes: [hash, 'otherhash'],
    });

    const result = await consumeBackupCode('user1', plainCode);
    expect(result).toBe(true);

    // Code should be removed after use
    expect((mockUser?.totpBackupCodes as string[])).not.toContain(hash);
    expect((mockUser?.totpBackupCodes as string[]).length).toBe(1);
  });

  it('rejects a backup code that was already used (not in the list)', async () => {
    const plainCode = 'abcdef1234';
    // Not stored — simulates an already-used or wrong code
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: true,
      totpBackupCodes: ['differenthash'],
    });

    await expect(consumeBackupCode('user1', plainCode)).rejects.toMatchObject({
      statusCode: 401,
      code: 'ERR_AUTH_2FA_INVALID_BACKUP_CODE',
    });
  });

  it('rejects an invalid backup code with 401', async () => {
    const hash = await bcrypt.hash('validcode12', 10);
    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: true,
      totpBackupCodes: [hash],
    });

    await expect(consumeBackupCode('user1', 'wrongcode1')).rejects.toMatchObject({
      statusCode: 401,
      code: 'ERR_AUTH_2FA_INVALID_BACKUP_CODE',
    });
  });

  it('a used backup code cannot be used again', async () => {
    const plainCode = 'abcdef1234';
    const hash = await bcrypt.hash(plainCode, 10);

    setupMockUser({
      _id: 'user1',
      email: 'user@example.com',
      totpEnabled: true,
      totpBackupCodes: [hash],
    });

    // First use succeeds
    await consumeBackupCode('user1', plainCode);

    // Second use: the code is gone from the list
    await expect(consumeBackupCode('user1', plainCode)).rejects.toMatchObject({
      statusCode: 401,
      code: 'ERR_AUTH_2FA_INVALID_BACKUP_CODE',
    });
  });
});

describe('AppError type checks', () => {
  it('AppError is an instance of Error', () => {
    const err = new AppError(400, 'test', 'ERR_TEST');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
  });
});
