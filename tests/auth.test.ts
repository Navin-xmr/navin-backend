import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { jest } from '@jest/globals';
import { AppError } from '../src/shared/http/errors.js';
import { OrganizationType } from '../src/shared/types/user.js';

type UserDoc = {
  _id: { toString(): string };
  email: string;
  name: string;
  role: string;
  organizationId?: { toString(): string } | null;
  passwordHash?: string;
};

type OrganizationDoc = {
  _id: { toString(): string };
  name: string;
  type: OrganizationType;
};

type UserDocPartial = Partial<UserDoc>;

const mockCreate = jest.fn() as jest.MockedFunction<(doc: Partial<UserDoc>) => Promise<UserDoc>>;
const mockFindOne = jest.fn() as jest.MockedFunction<
  (query: Record<string, unknown>) => Promise<UserDocPartial | null>
>;
const mockOrgFindById = jest.fn() as jest.MockedFunction<
  (id: string) => Promise<OrganizationDoc | null>
>;

jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    create: mockCreate,
    findOne: mockFindOne,
  },
  OrganizationModel: {
    findById: mockOrgFindById,
  },
  UserRole: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    VIEWER: 'VIEWER',
    CUSTOMER: 'CUSTOMER',
  },
  OrganizationType: {
    ENTERPRISE: 'ENTERPRISE',
    LOGISTICS: 'LOGISTICS',
  },
  UserRole: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    VIEWER: 'VIEWER',
    CUSTOMER: 'CUSTOMER',
  },
}));

const { env } = await import('../src/env.js');
const { signup, login, verifyToken } = await import('../src/modules/auth/auth.service.js');
const { requireAuth } = await import('../src/shared/middleware/requireAuth.js');

type TokenPayload = {
  userId: string;
  role: string;
  organizationId?: string;
  organizationType?: OrganizationType;
};

describe('Auth Service', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFindOne.mockReset();
    mockOrgFindById.mockReset();
  });

  describe('signup', () => {
    it('should create a new user and return a token', async () => {
      const mockUser: UserDoc = {
        _id: { toString: () => 'user-id-123' },
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        organizationId: null,
      };

      mockCreate.mockResolvedValue(mockUser);
      mockFindOne.mockResolvedValue(null);

      const result = await signup({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
        organizationId: 'org-id-123',
      });

      expect(result).toHaveProperty('token');
      expect(result.user).toEqual({
        id: mockUser._id,
        email: mockUser.email,
        name: mockUser.name,
        role: mockUser.role,
      });
    });

    it('should throw error if email already exists', async () => {
      mockFindOne.mockResolvedValue({ email: 'test@example.com' });

      await expect(
        signup({
          email: 'test@example.com',
          name: 'Test User',
          password: 'password123',
          organizationId: 'org-id-123',
        })
      ).rejects.toThrow('Email already in use');
    });

    it('ignores privileged role input and assigns VIEWER for public signup', async () => {
      const mockUser: UserDoc = {
        _id: { toString: () => 'user-id-124' },
        email: 'public@example.com',
        name: 'Public User',
        role: 'VIEWER',
        organizationId: null,
      };

      mockFindOne.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockUser);

      await signup({
        email: 'public@example.com',
        name: 'Public User',
        password: 'password123',
        organizationId: 'org-id-456',
        role: 'SUPER_ADMIN',
      } as unknown as Parameters<typeof signup>[0]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'VIEWER',
        })
      );
    });

    it('does not auto-assign ADMIN for privileged email domains in public signup', async () => {
      const mockUser: UserDoc = {
        _id: { toString: () => 'user-id-125' },
        email: 'ops@navin.io',
        name: 'Ops User',
        role: 'VIEWER',
        organizationId: null,
      };

      mockFindOne.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockUser);

      await signup({
        email: 'ops@navin.io',
        name: 'Ops User',
        password: 'password123',
        organizationId: 'org-id-457',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'VIEWER',
        })
      );
    });
  });

  describe('login', () => {
    it('should return a token on successful login', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser: UserDoc = {
        _id: { toString: () => 'user-id-123' },
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        organizationId: null,
        passwordHash: hashedPassword,
      };

      mockFindOne.mockResolvedValue(mockUser);

      const result = await login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('token');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should include organizationType in token when user has organization', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser: UserDoc = {
        _id: { toString: () => 'user-id-123' },
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        organizationId: { toString: () => 'org-id-123' },
        passwordHash: hashedPassword,
      };

      const mockOrg: OrganizationDoc = {
        _id: { toString: () => 'org-id-123' },
        name: 'Test Logistics',
        type: OrganizationType.LOGISTICS,
      };

      mockFindOne.mockResolvedValue(mockUser);
      mockOrgFindById.mockResolvedValue(mockOrg);

      const result = await login({
        email: 'test@example.com',
        password: 'password123',
      });

      const decoded = jwt.verify(result.token, env.JWT_SECRET) as TokenPayload;
      expect(decoded.organizationType).toBe(OrganizationType.LOGISTICS);
      expect(decoded.organizationId).toBe('org-id-123');
    });

    it('should handle missing organization gracefully', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser: UserDoc = {
        _id: { toString: () => 'user-id-123' },
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        organizationId: { toString: () => 'org-id-123' },
        passwordHash: hashedPassword,
      };

      mockFindOne.mockResolvedValue(mockUser);
      mockOrgFindById.mockResolvedValue(null);

      const result = await login({
        email: 'test@example.com',
        password: 'password123',
      });

      const decoded = jwt.verify(result.token, env.JWT_SECRET) as TokenPayload;
      expect(decoded.organizationType).toBeUndefined();
      expect(decoded.organizationId).toBe('org-id-123');
    });

    it('should throw error for invalid credentials (bad password)', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser: UserDoc = {
        _id: { toString: () => 'user-id-123' },
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        passwordHash: hashedPassword,
      };

      mockFindOne.mockResolvedValue(mockUser);

      await expect(
        login({
          email: 'test@example.com',
          password: 'wrongpassword',
        })
      ).rejects.toThrow('Invalid credentials');
    });

    it('should throw error if user not found', async () => {
      mockFindOne.mockResolvedValue(null);

      await expect(
        login({
          email: 'nonexistent@example.com',
          password: 'password123',
        })
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const payload: TokenPayload = {
        userId: 'user-id-123',
        role: 'user',
      };

      const token = jwt.sign(payload, env.JWT_SECRET);
      const decoded = verifyToken(token);

      expect(decoded.userId).toBe('user-id-123');
      expect(decoded.role).toBe('user');
    });

    it('should throw error for invalid token', () => {
      expect(() => {
        verifyToken('invalid-token');
      }).toThrow();
    });
  });

  describe('requireAuth middleware', () => {
    it('should reject requests without a valid Bearer token', () => {
      const req = { headers: {} } as Request;
      const res = {} as Response;
      const next = jest.fn();

      requireAuth(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0] as AppError;
      expect(error.statusCode).toBe(401);
      // Refactored for Issue #93: verify the standardized error code
      expect(error.code).toBe('ERR_AUTH_INVALID');
    });
  });
});
