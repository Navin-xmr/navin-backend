import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import { env } from '../src/env.js';

// Create mock functions
const mockCreate = jest.fn();
const mockFindOne = jest.fn();

// Mock the entire user module before importing anything else
jest.mock('../src/modules/users/users.model.js', () => ({
  UserModel: {
    create: mockCreate,
    findOne: mockFindOne,
  },
}));

// Now import after mocking
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

      // Verify password was hashed
      const userData = mockCreate.mock.calls[0][0];
      expect(userData.password).not.toBe('password123');
      const isHashed = await bcrypt.compare('password123', userData.password);
      expect(isHashed).toBe(true);
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

      // Verify token is valid
      const decoded = jwt.verify(result.token, env.JWT_SECRET) as TokenPayload;
      expect(decoded.userId).toBe('user-id-123');
      expect(decoded.role).toBe('user');
    });

    it('should throw error for invalid credentials', async () => {
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
    it('should verify a valid token', async () => {
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
