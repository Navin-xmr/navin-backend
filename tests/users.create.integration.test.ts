import { jest, describe, beforeAll, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

const mockRegisterUser = jest.fn<(...args: unknown[]) => Promise<unknown>>();

await jest.unstable_mockModule('../src/modules/users/users.service.js', () => ({
  registerUser: mockRegisterUser,
}));

await jest.unstable_mockModule('../src/infra/mongo/connection.js', () => ({
  connectDB: jest.fn(() => Promise.resolve()),
}));

await jest.unstable_mockModule('../src/shared/middleware/rateLimiter.js', () => ({
  standardLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  strictLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    findById: jest.fn(() => Promise.resolve(null)),
  },
  OrganizationModel: {
    find: jest.fn(() => Promise.resolve([])),
    findById: jest.fn(() => Promise.resolve(null)),
  },
  UserRole: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    VIEWER: 'VIEWER',
  },
  OrganizationType: {
    ENTERPRISE: 'ENTERPRISE',
    LOGISTICS: 'LOGISTICS',
  },
}));

const { buildApp } = await import('../src/app.js');

describe('POST /api/users Integration', () => {
  let app: Application;

  beforeAll(async () => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const generateToken = (payload: object) => {
    return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret');
  };

  it('should return 401 if unauthenticated', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ email: 'test@example.com', name: 'Test User', role: 'VIEWER' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('should return 403 if authenticated but non-admin (MANAGER)', async () => {
    const token = generateToken({ userId: 'manager1', role: 'MANAGER', organizationId: 'org1' });

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'test@example.com', name: 'Test User', role: 'VIEWER' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('should return 403 if authenticated but non-admin (VIEWER)', async () => {
    const token = generateToken({ userId: 'viewer1', role: 'VIEWER', organizationId: 'org1' });

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'test@example.com', name: 'Test User', role: 'VIEWER' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('should return 201 if admin succeeds, extracting organizationId from token', async () => {
    const token = generateToken({ userId: 'admin1', role: 'ADMIN', organizationId: 'org123' });

    mockRegisterUser.mockResolvedValueOnce({
      _id: 'newuser1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'VIEWER',
      organizationId: 'org123',
    });

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'test@example.com', name: 'Test User', role: 'VIEWER' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.organizationId).toBe('org123');
    
    // Ensure the service was called with the organizationId from the token
    expect(mockRegisterUser).toHaveBeenCalledWith({
      email: 'test@example.com',
      name: 'Test User',
      role: 'VIEWER',
      organizationId: 'org123',
    });
  });

  it('should return 400 for invalid payload', async () => {
    const token = generateToken({ userId: 'admin1', role: 'ADMIN', organizationId: 'org123' });

    // Missing required field 'name'
    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'test@example.com', role: 'VIEWER' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
