import request from 'supertest';
import express from 'express';
import { requireAuth } from '../src/shared/middleware/requireAuth.js';
import { requireRole } from '../src/shared/middleware/requireRole.js';
import { AppError } from '../src/shared/http/errors.js';

// Mock user roles
const adminUser = { id: '1', role: 'Admin' };
const managerUser = { id: '2', role: 'Manager' };
const viewerUser = { id: '3', role: 'Viewer' };

// Mock requireAuth to inject user
function mockRequireAuth(user: any) {
  return (req: any , res: any, next: any) => {
    req.user = user;
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
    app.use((err: any, req: any , res: any, next: any) => {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message, code: err.code });
      } else {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });
    return app;
  };

  it('allows Admin when Admin is required', async () => {
    const app = makeApp(adminUser, ['Admin']);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('blocks Viewer when Admin is required', async () => {
    const app = makeApp(viewerUser, ['Admin']);
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/forbidden/i);
  });

  it('allows Manager when Manager is required', async () => {
    const app = makeApp(managerUser, ['Manager']);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('blocks Admin when only Viewer is required', async () => {
    const app = makeApp(adminUser, ['Viewer']);
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/forbidden/i);
  });

  it('allows Admin or Manager when both are allowed', async () => {
    const app = makeApp(adminUser, ['Admin', 'Manager']);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    const app2 = makeApp(managerUser, ['Admin', 'Manager']);
    const res2 = await request(app2).get('/test');
    expect(res2.status).toBe(200);
  });

  it('blocks if req.user is missing', async () => {
    const app = makeApp(undefined, ['Admin']);
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/forbidden/i);
  });
});
