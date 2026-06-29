import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

type UserRecord = { _id: string; email: string; organizationId: string; role: string };

function makeUser(id: string, email: string): UserRecord {
  return { _id: id, email, organizationId: 'org-a', role: 'VIEWER' };
}

function makePage(
  users: UserRecord[],
  options: { limit?: number; cursor?: string; total?: number } = {}
) {
  const limit = options.limit ?? 20;
  let startIndex = 0;

  if (options.cursor) {
    const cursorIndex = users.findIndex(u => u._id === options.cursor);
    startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  }

  const slice = users.slice(startIndex, startIndex + limit + 1);
  const hasMore = slice.length > limit;
  const data = hasMore ? slice.slice(0, limit) : slice;

  return {
    data,
    total: options.total ?? users.length,
    hasMore,
    nextCursor: hasMore && data.length > 0 ? data[data.length - 1]._id : null,
  };
}

describe('GET /api/users', () => {
  let app: Application;
  const orgUsers: UserRecord[] = [];
  const findUsersByOrganizationId = jest.fn<
    (
      organizationId: string,
      filters?: { limit?: number; cursor?: string }
    ) => Promise<ReturnType<typeof makePage>>
  >();

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    orgUsers.length = 0;

    orgUsers.push(
      makeUser('u1', 'admin@orga.com'),
      makeUser('u2', 'manager@orga.com'),
      makeUser('u3', 'viewer1@orga.com'),
      makeUser('u4', 'viewer2@orga.com'),
      makeUser('u5', 'viewer3@orga.com')
    );

    findUsersByOrganizationId.mockImplementation(async (organizationId, filters) => {
      if (organizationId !== 'org-a') {
        return makePage([], { total: 0 });
      }
      return makePage(orgUsers, filters);
    });

    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(),
      findUsersByOrganizationId,
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('returns users for the authenticated organization with default limit', async () => {
    const token = jwt.sign(
      { userId: 'actor-1', role: 'ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!
    );

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta).toEqual({
      total: 5,
      hasMore: false,
      nextCursor: null,
    });
    expect(findUsersByOrganizationId).toHaveBeenCalledWith('org-a', { limit: 20, cursor: undefined });
  });

  it('returns paginated results without duplicates across pages', async () => {
    const token = jwt.sign(
      { userId: 'actor-1', role: 'ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!
    );

    const page1 = await request(app)
      .get('/api/users')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${token}`);

    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.hasMore).toBe(true);
    expect(page1.body.meta.nextCursor).toBe('u2');

    const page2 = await request(app)
      .get('/api/users')
      .query({ limit: 2, cursor: page1.body.meta.nextCursor })
      .set('Authorization', `Bearer ${token}`);

    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(2);
    expect(page2.body.meta.hasMore).toBe(true);

    const page1Ids = page1.body.data.map((u: UserRecord) => u._id);
    const page2Ids = page2.body.data.map((u: UserRecord) => u._id);
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('enforces maximum limit of 100', async () => {
    const token = jwt.sign(
      { userId: 'actor-1', role: 'ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!
    );

    const res = await request(app)
      .get('/api/users')
      .query({ limit: 101 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(findUsersByOrganizationId).not.toHaveBeenCalled();
  });

  it('returns 403 for unauthorized roles', async () => {
    const token = jwt.sign(
      { userId: 'viewer-1', role: 'VIEWER', organizationId: 'org-a' },
      process.env.JWT_SECRET!
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

  it('returns 400 when unknown query parameters are provided', async () => {
    const token = jwt.sign(
      { userId: 'actor-1', role: 'ADMIN', organizationId: 'org-a' },
      process.env.JWT_SECRET!
    );

    const res = await request(app)
      .get('/api/users')
      .query({ unexpected: 'value' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(findUsersByOrganizationId).not.toHaveBeenCalled();
  });
});
