import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import { UserModel } from '../src/modules/users/users.model.js';
import { env } from '../src/env.js';

jest.mock('../src/modules/users/users.model.js', () => ({
  UserModel: {
    create: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock('../src/infra/mongo/connection.js', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
}));

describe('Auth API', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/signup', () => {
    it('should create a new user and return a token', async () => {
      const mockUser = {
        _id: 'user-id-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        organizationId: null,
      };

      (UserModel.create as jest.Mock).mockResolvedValue(mockUser);
      (UserModel.findOne as jest.Mock).mockResolvedValue(null);

      const response = await request(app).post('/api/auth/signup').send({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user).toEqual({
        id: mockUser._id,
        email: mockUser.email,
        name: mockUser.name,
        role: mockUser.role,
      });
    });

    it('should return 409 if email is already in use', async () => {
      (UserModel.findOne as jest.Mock).mockResolvedValue({
        email: 'test@example.com',
      });

      const response = await request(app).post('/api/auth/signup').send({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
      });

      expect(response.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return a valid JWT on successful login', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser = {
        _id: 'user-id-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        organizationId: null,
        password: hashedPassword,
      };

      (UserModel.findOne as jest.Mock).mockResolvedValue(mockUser);

      const response = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('token');

      const decoded = jwt.verify(response.body.data.token, env.JWT_SECRET);
      expect(decoded).toHaveProperty('userId', mockUser._id);
      expect(decoded).toHaveProperty('role', mockUser.role);
    });

    it('should return 401 for invalid credentials', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser = {
        _id: 'user-id-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        password: hashedPassword,
      };

      (UserModel.findOne as jest.Mock).mockResolvedValue(mockUser);

      const response = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
    });

    it('should return 401 if user not found', async () => {
      (UserModel.findOne as jest.Mock).mockResolvedValue(null);

      const response = await request(app).post('/api/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('requireAuth middleware', () => {
    it('should reject requests without a valid Bearer token', async () => {
      const response = await request(app).get('/api/users');

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });
  });
});
