import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import { AppError } from '../src/shared/http/errors.js';

type UserDoc = {
  _id: { toString(): string };
  email: string;
  name: string;
  role: string;
  organizationId?: { toString(): string } | null;
  password?: string;
};

type UserDocPartial = Partial<UserDoc>;

const mockCreate = jest.fn() as jest.MockedFunction<(doc: Partial<UserDoc>) => Promise<UserDoc>>;
const mockFindOne = jest.fn() as jest.MockedFunction<
  (query: Record<string, unknown>) => Promise<UserDocPartial | null>
>;

jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    create: mockCreate,
    findOne: mockFindOne,
  },
}));

const { env } = await import('../src/env.js');
const { signup, login, verifyToken } = await import('../src/modules/auth/auth.service.js');
const { requireAuth } = await import('../src/shared/middleware/requireAuth.js');

type TokenPayload = {
  userId: string;
  role: string;
  organizationId?: string;
};

describe('Auth Service', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFindOne.mockReset();
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
        })
      ).rejects.toThrow('Email already in use');
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
        password: hashedPassword,
      };

      mockFindOne.mockResolvedValue(mockUser);

      const result = await login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('token');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw error for invalid credentials (bad password)', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser: UserDoc = {
        _id: { toString: () => 'user-id-123' },
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        password: hashedPassword,
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
      const req: any = { headers: {} };
      const res: any = {};
      const next = jest.fn();

      expect(() => requireAuth(req, res, next)).toThrow(AppError);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
