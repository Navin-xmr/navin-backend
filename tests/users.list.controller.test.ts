import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

describe('GET /api/users', () => {
  let app: Application;
  const findUsersByOrganizationId = jest.fn();

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    findUsersByOrganizationId.mockImplementation(async (organizationId: string) => {
      if (organizationId === 'org-a') {
        return [
          { _id: 'u1', email: 'admin@orga.com', organizationId: 'org-a', role: 'ADMIN' },
          { _id: 'u2', email: 'manager@orga.com', organizationId: 'org-a', role: 'MANAGER' },
        ];
      }
      return [];
    });

    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(),
      findUsersByOrganizationId,
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('returns users for the authenticated organization', async () => {
    const token = jwt.sign(
      { userId: 'actor-1', role: 'ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!,
    );

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(findUsersByOrganizationId).toHaveBeenCalledWith('org-a');
  });

  it('returns 403 for unauthorized roles', async () => {
    const token = jwt.sign(
      { userId: 'viewer-1', role: 'VIEWER', organizationId: 'org-a' },
      process.env.JWT_SECRET!,
    );

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/forbidden/i);
  });

  it('returns 403 when organization context is missing', async () => {
    const token = jwt.sign({ userId: 'admin-1', role: 'ADMIN' }, process.env.JWT_SECRET!);

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/organization context/i);
  });
});
