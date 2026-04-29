import request from 'supertest';
import express from 'express';
import { requireRole } from '../src/shared/middleware/requireRole.js';
import { AppError } from '../src/shared/http/errors.js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { UserRole } from '../src/shared/constants/index.js';

// Mock user roles
const adminUser = { userId: '1', role: UserRole.ADMIN, jti: 'mock-jti' };
const managerUser = { userId: '2', role: UserRole.MANAGER, jti: 'mock-jti' };
const viewerUser = { userId: '3', role: UserRole.VIEWER, jti: 'mock-jti' };

// Mock requireAuth to inject user
function mockRequireAuth(user: { userId: string; role: string } | undefined): RequestHandler {
  return (req, _res, next) => {
    (req as any).user = user;
    next();
  };
}

describe('requireRole middleware', () => {
  const makeApp = (user: any, allowedRoles: string[]) => {
    const app = express();
    app.get(
      '/test',
      mockRequireAuth(user),
      requireRole(...allowedRoles),
      (req, res) => res.status(200).json({ success: true })
    );
    // Error handler
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message, code: err.code });
      } else {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });
    return app;
  };

  it('allows Admin when Admin is required', async () => {
    const app = makeApp(adminUser, [UserRole.ADMIN]);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('blocks Viewer when Admin is required', async () => {
    const app = makeApp(viewerUser, [UserRole.ADMIN]);
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/forbidden/i);
  });

  it('allows Manager when Manager is required', async () => {
    const app = makeApp(managerUser, [UserRole.MANAGER]);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('blocks Admin when only Viewer is required', async () => {
    const app = makeApp(adminUser, [UserRole.VIEWER]);
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/forbidden/i);
  });

  it('allows Admin or Manager when both are allowed', async () => {
    const app = makeApp(adminUser, [UserRole.ADMIN, UserRole.MANAGER]);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    const app2 = makeApp(managerUser, [UserRole.ADMIN, UserRole.MANAGER]);
    const res2 = await request(app2).get('/test');
    expect(res2.status).toBe(200);
  });

  it('blocks if req.user is missing', async () => {
    const app = makeApp(undefined, [UserRole.ADMIN]);
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/forbidden/i);
  });
});
