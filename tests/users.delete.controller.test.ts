import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

describe('DELETE /api/users/:id', () => {
  let app: Application;

  const mockDeletedUser = {
    _id: 'user-to-delete',
    email: 'target@example.com',
    organizationId: 'org-a',
    role: 'VIEWER',
    deletedAt: new Date().toISOString(),
  };

  const findByIdAndUpdate = jest.fn<() => Promise<typeof mockDeletedUser | null>>();

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    findByIdAndUpdate.mockResolvedValue(mockDeletedUser);

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: { findByIdAndUpdate },
      OrganizationModel: {},
      OrganizationType: {},
      UserRole: {},
    }));

    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(),
      findUsersByOrganizationId: jest.fn(),
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('returns standard envelope on successful deletion (ADMIN)', async () => {
    const token = jwt.sign(
      { userId: 'admin-1', role: 'ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!,
    );

    const res = await request(app)
      .delete('/api/users/user-to-delete')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.data).toBeDefined();
    expect(res.body.data._id).toBe('user-to-delete');
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).delete('/api/users/user-to-delete');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 when caller has insufficient role (VIEWER)', async () => {
    const token = jwt.sign(
      { userId: 'viewer-1', role: 'VIEWER', organizationId: 'org-a' },
      process.env.JWT_SECRET!,
    );

    const res = await request(app)
      .delete('/api/users/user-to-delete')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/forbidden/i);
  });

  it('returns 400 when id param is empty string', async () => {
    const token = jwt.sign(
      { userId: 'admin-1', role: 'ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!,
    );

    // Route requires a non-empty :id; an explicit empty segment won't match the route,
    // so we test a whitespace-only id via the param validator.
    const res = await request(app)
      .delete('/api/users/%20')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 when the target user does not exist', async () => {
    findByIdAndUpdate.mockResolvedValue(null);

    const token = jwt.sign(
      { userId: 'admin-1', role: 'ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!,
    );

    const res = await request(app)
      .delete('/api/users/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('SUPER_ADMIN can also delete users', async () => {
    const token = jwt.sign(
      { userId: 'super-1', role: 'SUPER_ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!,
    );

    const res = await request(app)
      .delete('/api/users/user-to-delete')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
