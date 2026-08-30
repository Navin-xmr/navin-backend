/**
 * Unit tests for POST /api/auth/2fa/setup
 *
 * Coverage:
 *  1. 200 — returns a non-empty qrCodeUrl
 *  2. Secret stored in DB is not plaintext (it is AES-GCM encrypted)
 *  3. 401 — unauthenticated (no Bearer token)
 */

import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import { AppError } from '../../../shared/http/errors.js';

// ---------------------------------------------------------------------------
// Mock UserModel
// ---------------------------------------------------------------------------

type UserDocLean = {
  _id: { toString(): string };
  email: string;
  name: string;
  role: string;
  twoFactorSecret?: string | null;
  twoFactorEnabled?: boolean;
  deletedAt?: Date | null;
};

const mockFindById = jest.fn();
const mockFindByIdAndUpdate = jest.fn();

jest.unstable_mockModule('../../../modules/users/users.model.js', () => ({
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
  OrganizationModel: {
    findById: jest.fn(),
    findOne: jest.fn(),
  },
  OrganizationType: {
    ENTERPRISE: 'ENTERPRISE',
    LOGISTICS: 'LOGISTICS',
  },
}));

// ---------------------------------------------------------------------------
// Mock qrcode — we don't want binary canvas rendering in tests
// ---------------------------------------------------------------------------
jest.unstable_mockModule('qrcode', () => ({
  default: {
    toDataURL: jest.fn(async (_url: string) => 'data:image/png;base64,TESTQRCODE'),
  },
  toDataURL: jest.fn(async (_url: string) => 'data:image/png;base64,TESTQRCODE'),
}));

// ---------------------------------------------------------------------------
// Dynamic imports after mocks are in place
// ---------------------------------------------------------------------------
const { setup2fa } = await import('../auth.service.js');
const { requireAuth } = await import('../../../shared/middleware/requireAuth.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = 'user-id-abc';

function makeMockUser(overrides: Partial<UserDocLean> = {}): UserDocLean {
  return {
    _id: { toString: () => MOCK_USER_ID },
    email: 'alice@example.com',
    name: 'Alice',
    role: 'VIEWER',
    twoFactorSecret: null,
    twoFactorEnabled: false,
    deletedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test: setup2fa service
// ---------------------------------------------------------------------------

describe('setup2fa service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockResolvedValue(null);
  });

  it('returns a non-empty qrCodeUrl for a valid user', async () => {
    // Mock chain: findById(id).select('+twoFactorSecret').lean()
    mockFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(makeMockUser()),
      }),
    });

    const result = await setup2fa(MOCK_USER_ID);

    expect(result).toHaveProperty('qrCodeUrl');
    expect(typeof result.qrCodeUrl).toBe('string');
    expect(result.qrCodeUrl.length).toBeGreaterThan(0);
  });

  it('stores an encrypted (non-plaintext) secret in the database', async () => {
    mockFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(makeMockUser()),
      }),
    });

    await setup2fa(MOCK_USER_ID);

    // findByIdAndUpdate must have been called with twoFactorSecret set
    expect(mockFindByIdAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = mockFindByIdAndUpdate.mock.calls[0] as [
      unknown,
      { twoFactorSecret: string; twoFactorEnabled: boolean },
    ];

    expect(update).toHaveProperty('twoFactorSecret');
    const storedSecret: string = update.twoFactorSecret;

    // The stored value must be the colon-delimited encrypted format <iv>:<tag>:<ct>
    // and must NOT be a raw base32 string (which would contain only A-Z and 2-7).
    const isRawBase32 = /^[A-Z2-7]+=*$/.test(storedSecret);
    expect(isRawBase32).toBe(false);

    // Confirm it has the expected 3-segment encrypted format
    const segments = storedSecret.split(':');
    expect(segments).toHaveLength(3);
    // Each segment is a non-empty hex string
    segments.forEach(seg => {
      expect(seg.length).toBeGreaterThan(0);
      expect(/^[0-9a-f]+$/i.test(seg)).toBe(true);
    });
  });

  it('does NOT set twoFactorEnabled = true (setup only; verify comes later)', async () => {
    mockFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(makeMockUser()),
      }),
    });

    await setup2fa(MOCK_USER_ID);

    const [, update] = mockFindByIdAndUpdate.mock.calls[0] as [
      unknown,
      { twoFactorEnabled: boolean },
    ];
    expect(update.twoFactorEnabled).toBe(false);
  });

  it('throws 401 when the user does not exist', async () => {
    mockFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    await expect(setup2fa(MOCK_USER_ID)).rejects.toMatchObject({
      statusCode: 401,
      code: 'ERR_AUTH_INVALID',
    });
  });

  it('throws 401 when the user has been soft-deleted', async () => {
    mockFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(makeMockUser({ deletedAt: new Date() })),
      }),
    });

    await expect(setup2fa(MOCK_USER_ID)).rejects.toMatchObject({
      statusCode: 401,
      code: 'ERR_AUTH_INVALID',
    });
  });
});

// ---------------------------------------------------------------------------
// Test: requireAuth middleware — unauthenticated request returns 401
// ---------------------------------------------------------------------------

describe('requireAuth middleware (2FA route guard)', () => {
  it('rejects requests without a Bearer token with 401 ERR_AUTH_INVALID', () => {
    const req = { headers: {} } as Request;
    const res = {} as Response;
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const error = next.mock.calls[0][0] as AppError;
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('ERR_AUTH_INVALID');
  });
});
