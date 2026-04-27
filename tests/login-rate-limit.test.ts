import { jest, describe, beforeAll, it, expect } from '@jest/globals';
import request from 'supertest';
import type { Application } from 'express';

type UserRecord = { _id: string; email: string; passwordHash: string; role: string } & Record<string, unknown>;
const usersData: UserRecord[] = [];

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => {
  const UserModel = {
    findOne: (query: { email: string }) => {
      const user = usersData.find(u => u.email === query.email);
      return Promise.resolve(user || null);
    },
    create: (data: Record<string, unknown>) => {
      const user = { ...data, _id: String(usersData.length) } as UserRecord;
      usersData.push(user);
      return Promise.resolve(user);
    },
  };
  return { UserModel };
});

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  initSocketIO: jest.fn(),
  getIO: jest.fn(),
  emitAnomalyDetected: jest.fn(),
  emitTelemetryUpdate: jest.fn(),
  emitStatusUpdate: jest.fn(),
}));

describe('Login Rate Limiting', () => {
  let app: Application;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = (appModule.buildApp as () => Application)();
  });

  it('should return 429 after 5 failed login attempts within 15 minutes', async () => {
    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'brute@force.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
    }

    // 6th attempt should be rate limited
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'brute@force.com', password: 'wrongpassword' });

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Too many');
  });

  it('should include rate limit headers in response', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' });

    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['ratelimit-reset']).toBeDefined();
  });
});
