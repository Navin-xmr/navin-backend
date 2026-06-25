import { describe, it, expect, jest, beforeAll } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Application } from 'express';

const JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long!';

function makeToken(role: string) {
  return jwt.sign(
    { userId: 'user-1', email: 'test@test.com', role, organizationId: 'org-1', jti: randomUUID() },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
  generateApiKey: jest.fn().mockResolvedValue({ _id: 'key-1', apiKey: 'nvk_test123' }),
  listApiKeys: jest.fn().mockResolvedValue([]),
  revokeApiKey: jest.fn().mockResolvedValue(undefined),
  validateApiKey: jest.fn().mockResolvedValue({ isValid: false }),
}));

await jest.unstable_mockModule('../src/modules/auth/auth.service.js', () => ({
  signup: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  verifyToken: jest.fn((token: string) => jwt.verify(token, JWT_SECRET) as { userId: string; role: string; jti?: string }),
}));

await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
  getRedisClient: () => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    exists: jest.fn(async () => 0),
  }),
  getRedisConnection: () => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
  }),
  disconnectRedis: jest.fn(async () => undefined),
}));

await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
  isTokenBlocked: jest.fn(async () => false),
  blockToken: jest.fn(async () => undefined),
  BLOCKLIST_PREFIX: 'blocklist:uuid:',
  isValidJti: jest.fn(() => true),
}));

const { authRouter } = await import('../src/modules/auth/auth.routes.js');
const express = await import('express');
const { errorMiddleware } = await import('../src/shared/http/errorMiddleware.js');

function createApp(): Application {
  const app = express.default();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use(errorMiddleware());
  return app;
}

describe('Issue #266: requireRole on API key management routes', () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  describe('POST /api/auth/api-keys', () => {
    it('returns 403 for VIEWER role', async () => {
      const res = await request(app)
        .post('/api/auth/api-keys')
        .set('Authorization', `Bearer ${makeToken('VIEWER')}`)
        .send({ name: 'test-key', organizationId: 'org-1' });
      expect(res.status).toBe(403);
    });

    it('returns 403 for CUSTOMER role', async () => {
      const res = await request(app)
        .post('/api/auth/api-keys')
        .set('Authorization', `Bearer ${makeToken('CUSTOMER')}`)
        .send({ name: 'test-key', organizationId: 'org-1' });
      expect(res.status).toBe(403);
    });

    it('allows ADMIN role', async () => {
      const res = await request(app)
        .post('/api/auth/api-keys')
        .set('Authorization', `Bearer ${makeToken('ADMIN')}`)
        .send({ name: 'test-key', organizationId: 'org-1' });
      expect(res.status).not.toBe(403);
    });

    it('allows SUPER_ADMIN role', async () => {
      const res = await request(app)
        .post('/api/auth/api-keys')
        .set('Authorization', `Bearer ${makeToken('SUPER_ADMIN')}`)
        .send({ name: 'test-key', organizationId: 'org-1' });
      expect(res.status).not.toBe(403);
    });

    it('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/auth/api-keys')
        .send({ name: 'test-key', organizationId: 'org-1' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/api-keys/:organizationId', () => {
    it('returns 403 for VIEWER role', async () => {
      const res = await request(app)
        .get('/api/auth/api-keys/org-1')
        .set('Authorization', `Bearer ${makeToken('VIEWER')}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 for MANAGER role', async () => {
      const res = await request(app)
        .get('/api/auth/api-keys/org-1')
        .set('Authorization', `Bearer ${makeToken('MANAGER')}`);
      expect(res.status).toBe(403);
    });

    it('allows ADMIN role', async () => {
      const res = await request(app)
        .get('/api/auth/api-keys/org-1')
        .set('Authorization', `Bearer ${makeToken('ADMIN')}`);
      expect(res.status).not.toBe(403);
    });

    it('allows SUPER_ADMIN role', async () => {
      const res = await request(app)
        .get('/api/auth/api-keys/org-1')
        .set('Authorization', `Bearer ${makeToken('SUPER_ADMIN')}`);
      expect(res.status).not.toBe(403);
    });

    it('returns 401 without token', async () => {
      const res = await request(app)
        .get('/api/auth/api-keys/org-1');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/auth/api-keys/:apiKeyId', () => {
    it('returns 403 for VIEWER role', async () => {
      const res = await request(app)
        .delete('/api/auth/api-keys/key-1')
        .set('Authorization', `Bearer ${makeToken('VIEWER')}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 for CUSTOMER role', async () => {
      const res = await request(app)
        .delete('/api/auth/api-keys/key-1')
        .set('Authorization', `Bearer ${makeToken('CUSTOMER')}`);
      expect(res.status).toBe(403);
    });

    it('allows ADMIN role', async () => {
      const res = await request(app)
        .delete('/api/auth/api-keys/key-1')
        .set('Authorization', `Bearer ${makeToken('ADMIN')}`);
      expect(res.status).not.toBe(403);
    });

    it('allows SUPER_ADMIN role', async () => {
      const res = await request(app)
        .delete('/api/auth/api-keys/key-1')
        .set('Authorization', `Bearer ${makeToken('SUPER_ADMIN')}`);
      expect(res.status).not.toBe(403);
    });

    it('returns 401 without token', async () => {
      const res = await request(app)
        .delete('/api/auth/api-keys/key-1');
      expect(res.status).toBe(401);
    });
  });
});
