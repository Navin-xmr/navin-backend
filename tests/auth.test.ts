import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

// Mock mongoose
jest.mock('mongoose', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  connection: { close: jest.fn() },
  model: jest.fn(),
  Schema: class {
    constructor() {}
    Types: {};
  },
}));

// Manual mock for users.model.ts
const mockCreate = jest.fn();
const mockFindOne = jest.fn();
jest.mock('../src/modules/users/users.model.js', () => ({
  UserModel: {
    create: mockCreate,
    findOne: mockFindOne,
  },
}));

// Import after mocks
import { env } from '../src/env.js';
import { signup, login, verifyToken, type TokenPayload } from '../src/modules/auth/auth.service.js';

describe('Auth Service', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFindOne.mockReset();
  });

  describe('signup', () => {
    it('should create a new user and return a token', async () => {
      const mockUser: any = {
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
      const hashedPassword1 = await bcrypt.hash('password123', 10);
      const mockUser: any = {
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
      const mockUser: any = {
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
});
