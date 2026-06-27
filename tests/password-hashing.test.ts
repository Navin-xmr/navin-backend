/**
 * Tests for Issue #48 — Password hashing consistency.
 *
 * Verifies that:
 * 1. Signup hashes the password exactly once (service layer only).
 * 2. Invitation acceptance hashes the password exactly once (service layer only).
 * 3. Team members created without a password cannot authenticate.
 *
 * All DB and JWT operations are mocked; only bcrypt calls are real
 * to exercise the actual hashing logic end-to-end.
 */
import bcrypt from 'bcrypt';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

function makeUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => 'user-id-123' },
    email: 'test@example.com',
    name: 'Test User',
    role: 'VIEWER',
    organizationId: { toString: () => 'org-id-1' },
    ...overrides,
  };
}

/** Build a full users.model.js mock that includes all named exports auth.service.ts needs. */
function makeModelMock(
  mockCreate: jest.Mock,
  mockFindOne: jest.Mock,
  mockOrgFindById: jest.Mock,
) {
  return {
    UserModel: { create: mockCreate, findOne: mockFindOne },
    OrganizationModel: { findById: mockOrgFindById },
    OrganizationType: {
      ENTERPRISE: 'ENTERPRISE',
      LOGISTICS: 'LOGISTICS',
      SUPPLY_CHAIN: 'SUPPLY_CHAIN',
    },
    UserRole: {
      SUPER_ADMIN: 'SUPER_ADMIN',
      ADMIN: 'ADMIN',
      MANAGER: 'MANAGER',
      VIEWER: 'VIEWER',
      CUSTOMER: 'CUSTOMER',
    },
  };
}

// ---------------------------------------------------------------------------
// Signup flow
// ---------------------------------------------------------------------------

describe('Password hashing — signup flow', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('stores a bcrypt hash (not plaintext) for a new signup', async () => {
    let capturedPasswordHash = '';

    const mockCreate = jest.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>(
      async (...args) => {
        const doc = args[0] as Record<string, unknown>;
        capturedPasswordHash = doc['passwordHash'] as string;
        return makeUserDoc({ passwordHash: doc['passwordHash'] });
      },
    );
    const mockFindOne = jest.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null);
    const mockOrgFindById = jest
      .fn<(...args: unknown[]) => Promise<null>>()
      .mockResolvedValue(null);

    jest.unstable_mockModule(
      '../src/modules/users/users.model.js',
      () => makeModelMock(mockCreate, mockFindOne, mockOrgFindById),
    );

    const { signup } = await import('../src/modules/auth/auth.service.js');

    await signup({
      email: 'test@example.com',
      name: 'Test User',
      password: 'plaintext123',
      organizationId: 'org-id-1',
    });

    // Must be a bcrypt hash — not the original plaintext
    expect(capturedPasswordHash).not.toBe('plaintext123');
    expect(capturedPasswordHash.startsWith('$2')).toBe(true);

    // bcrypt.compare must verify correctly (single hash round)
    const isValid = await bcrypt.compare('plaintext123', capturedPasswordHash);
    expect(isValid).toBe(true);
  });

  it('hashed value is NOT double-hashed (bcrypt.compare succeeds on single hash)', async () => {
    // If the old bug were present, capturedPasswordHash would be a bcrypt hash of a
    // bcrypt hash, and bcrypt.compare('plaintext', doubleHashed) would return false.
    let capturedPasswordHash = '';

    const mockCreate = jest.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>(
      async (...args) => {
        const doc = args[0] as Record<string, unknown>;
        capturedPasswordHash = doc['passwordHash'] as string;
        return makeUserDoc({ passwordHash: doc['passwordHash'] });
      },
    );
    const mockFindOne = jest.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null);
    const mockOrgFindById = jest
      .fn<(...args: unknown[]) => Promise<null>>()
      .mockResolvedValue(null);

    jest.unstable_mockModule(
      '../src/modules/users/users.model.js',
      () => makeModelMock(mockCreate, mockFindOne, mockOrgFindById),
    );

    const { signup } = await import('../src/modules/auth/auth.service.js');

    await signup({
      email: 'user2@example.com',
      name: 'Another User',
      password: 'mySecurePass!',
      organizationId: 'org-id-1',
    });

    const isValid = await bcrypt.compare('mySecurePass!', capturedPasswordHash);
    expect(isValid).toBe(true); // would fail if double-hashed
  });

  it('throws 409 when email is already in use', async () => {
    const mockCreate = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc());
    const mockFindOne = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc({ email: 'taken@example.com' }));
    const mockOrgFindById = jest
      .fn<(...args: unknown[]) => Promise<null>>()
      .mockResolvedValue(null);

    jest.unstable_mockModule(
      '../src/modules/users/users.model.js',
      () => makeModelMock(mockCreate, mockFindOne, mockOrgFindById),
    );

    const { signup } = await import('../src/modules/auth/auth.service.js');

    await expect(
      signup({ email: 'taken@example.com', name: 'X', password: 'pass', organizationId: 'org-1' }),
    ).rejects.toThrow('Email already in use');
  });
});

// ---------------------------------------------------------------------------
// Invitation acceptance flow
// ---------------------------------------------------------------------------

describe('Password hashing — invitation acceptance flow', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('stores a bcrypt hash after invitation acceptance', async () => {
    let capturedPasswordHash = '';

    const mockCreate = jest.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>(
      async (...args) => {
        const doc = args[0] as Record<string, unknown>;
        capturedPasswordHash = doc['passwordHash'] as string;
        return makeUserDoc({ passwordHash: doc['passwordHash'] });
      },
    );

    jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
      findUsersByOrganizationId: jest.fn(),
    }));

    jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: { create: mockCreate },
      UserRole: {
        SUPER_ADMIN: 'SUPER_ADMIN',
        ADMIN: 'ADMIN',
        MANAGER: 'MANAGER',
        VIEWER: 'VIEWER',
        CUSTOMER: 'CUSTOMER',
      },
    }));

    const service = await import('../src/modules/users/users.service.js');

    const invitation = await service.generateInvitationLink({
      email: 'invited@example.com',
      role: 'VIEWER',
      inviterUserId: 'admin-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-id-1',
    });

    await service.acceptInvitation({
      token: invitation.token,
      name: 'New Member',
      password: 'InvitationPass99!',
    });

    expect(capturedPasswordHash).not.toBe('InvitationPass99!');
    expect(capturedPasswordHash.startsWith('$2')).toBe(true);

    const isValid = await bcrypt.compare('InvitationPass99!', capturedPasswordHash);
    expect(isValid).toBe(true);
  });

  it('throws 409 when invited email is already registered', async () => {
    const mockCreate = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc());

    jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest
        .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
        .mockResolvedValue(makeUserDoc({ email: 'invited@example.com' })),
      findUsersByOrganizationId: jest.fn(),
    }));

    jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: { create: mockCreate },
      UserRole: {
        SUPER_ADMIN: 'SUPER_ADMIN',
        ADMIN: 'ADMIN',
        MANAGER: 'MANAGER',
        VIEWER: 'VIEWER',
        CUSTOMER: 'CUSTOMER',
      },
    }));

    const service = await import('../src/modules/users/users.service.js');

    const jwt = await import('jsonwebtoken');
    const { env } = await import('../src/env.js');
    const token = jwt.default.sign(
      {
        type: 'USER_INVITATION',
        email: 'invited@example.com',
        role: 'VIEWER',
        organizationId: 'org-1',
        invitedBy: 'admin-1',
      },
      env.JWT_SECRET,
      { expiresIn: 3600 },
    );

    await expect(
      service.acceptInvitation({ token, name: 'Dup User', password: 'pass123' }),
    ).rejects.toThrow('Email already in use');
  });

  it('throws on invalid invitation token', async () => {
    jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
      findUsersByOrganizationId: jest.fn(),
    }));

    jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        create: jest.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>(),
      },
      UserRole: {
        SUPER_ADMIN: 'SUPER_ADMIN',
        ADMIN: 'ADMIN',
        MANAGER: 'MANAGER',
        VIEWER: 'VIEWER',
        CUSTOMER: 'CUSTOMER',
      },
    }));

    const service = await import('../src/modules/users/users.service.js');

    await expect(
      service.acceptInvitation({ token: 'not-a-valid-jwt', name: 'X', password: 'pass' }),
    ).rejects.toThrow('Invalid or expired invitation token');
  });
});

// ---------------------------------------------------------------------------
// Team member creation flow
// ---------------------------------------------------------------------------

describe('Password hashing — team member creation flow', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('stores a bcrypt-hashed placeholder (not empty string) for team members', async () => {
    let capturedDoc: Record<string, unknown> = {};

    const mockCreateUser = jest.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>(
      async (...args) => {
        capturedDoc = args[0] as Record<string, unknown>;
        return makeUserDoc(capturedDoc);
      },
    );

    jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: mockCreateUser,
      findUserByEmail: jest.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
      findUsersByOrganizationId: jest.fn(),
    }));

    jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        create: jest.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>(),
      },
      UserRole: {
        SUPER_ADMIN: 'SUPER_ADMIN',
        ADMIN: 'ADMIN',
        MANAGER: 'MANAGER',
        VIEWER: 'VIEWER',
        CUSTOMER: 'CUSTOMER',
      },
    }));

    const service = await import('../src/modules/users/users.service.js');

    await service.createTeamMember({
      email: 'member@example.com',
      name: 'Team Member',
      callerOrganizationId: 'org-id-1',
    });

    const capturedPasswordHash = capturedDoc['passwordHash'] as string;

    // Must NOT be an empty string
    expect(capturedPasswordHash).not.toBe('');

    // Must be a valid bcrypt hash
    expect(capturedPasswordHash.startsWith('$2')).toBe(true);

    // No real password should match this random placeholder
    const isValid = await bcrypt.compare('anyguess', capturedPasswordHash);
    expect(isValid).toBe(false);
  });

  it('throws 409 if team member email is already registered', async () => {
    const mockCreateUser = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc());

    jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: mockCreateUser,
      findUserByEmail: jest
        .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
        .mockResolvedValue(makeUserDoc({ email: 'taken@example.com' })),
      findUsersByOrganizationId: jest.fn(),
    }));

    jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        create: jest.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>(),
      },
      UserRole: {
        SUPER_ADMIN: 'SUPER_ADMIN',
        ADMIN: 'ADMIN',
        MANAGER: 'MANAGER',
        VIEWER: 'VIEWER',
        CUSTOMER: 'CUSTOMER',
      },
    }));

    const service = await import('../src/modules/users/users.service.js');

    await expect(
      service.createTeamMember({
        email: 'taken@example.com',
        name: 'Dup',
        callerOrganizationId: 'org-id-1',
      }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Email already in use' });
  });
});

// ---------------------------------------------------------------------------
// Login verification — end-to-end round-trip
// ---------------------------------------------------------------------------

describe('Password hashing — login round-trip', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('login succeeds after signup with correct password', async () => {
    const storedHash = await bcrypt.hash('testPassword1!', 10);

    const mockFindOne = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc({ passwordHash: storedHash, organizationId: null }));
    const mockCreate = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc());
    const mockOrgFindById = jest
      .fn<(...args: unknown[]) => Promise<null>>()
      .mockResolvedValue(null);

    jest.unstable_mockModule(
      '../src/modules/users/users.model.js',
      () => makeModelMock(mockCreate, mockFindOne, mockOrgFindById),
    );

    const { login } = await import('../src/modules/auth/auth.service.js');

    const result = await login({ email: 'test@example.com', password: 'testPassword1!' });
    expect(result).toHaveProperty('token');
    expect(result.user.email).toBe('test@example.com');
  });

  it('login fails after signup with wrong password', async () => {
    const storedHash = await bcrypt.hash('realPassword', 10);

    const mockFindOne = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc({ passwordHash: storedHash, organizationId: null }));
    const mockCreate = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc());
    const mockOrgFindById = jest
      .fn<(...args: unknown[]) => Promise<null>>()
      .mockResolvedValue(null);

    jest.unstable_mockModule(
      '../src/modules/users/users.model.js',
      () => makeModelMock(mockCreate, mockFindOne, mockOrgFindById),
    );

    const { login } = await import('../src/modules/auth/auth.service.js');

    await expect(
      login({ email: 'test@example.com', password: 'wrongPassword' }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('team member without a real password cannot authenticate (locked hash)', async () => {
    // Simulate what createTeamMember stores: a random bcrypt hash of random bytes
    const lockedHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    const mockFindOne = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc({ passwordHash: lockedHash, organizationId: null }));
    const mockCreate = jest
      .fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUserDoc>>>()
      .mockResolvedValue(makeUserDoc());
    const mockOrgFindById = jest
      .fn<(...args: unknown[]) => Promise<null>>()
      .mockResolvedValue(null);

    jest.unstable_mockModule(
      '../src/modules/users/users.model.js',
      () => makeModelMock(mockCreate, mockFindOne, mockOrgFindById),
    );

    const { login } = await import('../src/modules/auth/auth.service.js');

    await expect(
      login({ email: 'member@example.com', password: '' }),
    ).rejects.toThrow('Invalid credentials');

    // Reset for next call (module cached, mock not reset)
    mockFindOne.mockResolvedValue(makeUserDoc({ passwordHash: lockedHash, organizationId: null }));

    await expect(
      login({ email: 'member@example.com', password: 'anyguess123' }),
    ).rejects.toThrow('Invalid credentials');
  });
});
