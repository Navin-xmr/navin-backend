/**
 * Template module integration tests.
 *
 * Copy-paste this file when scaffolding a new module.
 * Replace "__template__" / "Template" / "/api/templates" with your module name.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import express from 'express';
import { TemplateModel } from '../../template.model.js';
import { templateRouter } from '../../template.routes.js';
import { errorMiddleware } from '../../../../shared/http/errorMiddleware.js';

// Build a minimal app that mounts only this module's router.
// This avoids depending on app.ts registering the template routes.
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/templates', templateRouter);
  app.use(errorMiddleware());
  return app;
}

const app = buildTestApp();

// ── JWT helpers ───────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET!;

function mintToken(role: string, orgId = new mongoose.Types.ObjectId().toString()) {
  return jwt.sign(
    { userId: new mongoose.Types.ObjectId().toString(), role, organizationId: orgId },
    JWT_SECRET
  );
}

// ── Seed helper ───────────────────────────────────────────────────────────────
async function seedTemplate(overrides: Record<string, unknown> = {}) {
  return TemplateModel.create({
    name: 'Test Template',
    description: 'A test template',
    ...overrides,
  });
}

describe('Templates API', () => {
  afterEach(async () => {
    await TemplateModel.deleteMany({});
  });

  describe('POST /api/templates', () => {
    it('returns 401 without auth', async () => {
      await request(app).post('/api/templates').send({ name: 'New Template' }).expect(401);
    });

    it('returns 403 with insufficient role (VIEWER cannot create)', async () => {
      const viewerToken = mintToken('VIEWER');
      await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'New Template' })
        .expect(403);
    });

    it('returns 400 on validation failure', async () => {
      const adminToken = mintToken('ADMIN');
      await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '' })
        .expect(400);
    });

    it('returns 201 and creates a template (ADMIN)', async () => {
      const adminToken = mintToken('ADMIN');
      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Template', description: 'Desc' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('New Template');
    });
  });

  describe('GET /api/templates', () => {
    it('returns 401 without auth', async () => {
      await request(app).get('/api/templates').expect(401);
    });

    it('returns 200 with paginated list (VIEWER can read)', async () => {
      const viewerToken = mintToken('VIEWER');
      await seedTemplate({ name: 'T1' });
      await seedTemplate({ name: 'T2' });

      const res = await request(app)
        .get('/api/templates?page=1&limit=10')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.total).toBe(2);
    });
  });

  describe('GET /api/templates/:id', () => {
    it('returns 404 for non-existent id', async () => {
      const adminToken = mintToken('ADMIN');
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .get(`/api/templates/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 200 for existing template', async () => {
      const adminToken = mintToken('ADMIN');
      const template = await seedTemplate({ name: 'T1' });

      const res = await request(app)
        .get(`/api/templates/${template._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('T1');
    });
  });
});
