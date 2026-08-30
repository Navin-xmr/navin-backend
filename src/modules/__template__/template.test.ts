import { jest } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { buildApp } from '../src/app.js';
import { TemplateModel } from '../src/modules/__template__/template.model.js';

// Mock externals
await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
  tokenizeShipment: jest.fn(),
}));

const app = buildApp();

// Helper to create a test template directly in the DB
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

    it('returns 403 with insufficient role', async () => {
      // VIEWER cannot create
      await request(app)
        .post('/api/templates')
        .set('Authorization', 'Bearer viewer-token')
        .send({ name: 'New Template' })
        .expect(403);
    });

    it('returns 400 on validation failure', async () => {
      await request(app)
        .post('/api/templates')
        .set('Authorization', 'Bearer admin-token')
        .send({ name: '' })
        .expect(400);
    });

    it('returns 201 and creates a template', async () => {
      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', 'Bearer admin-token')
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

    it('returns 200 with paginated list', async () => {
      await seedTemplate({ name: 'T1' });
      await seedTemplate({ name: 'T2' });

      const res = await request(app)
        .get('/api/templates?page=1&limit=10')
        .set('Authorization', 'Bearer admin-token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.total).toBe(2);
    });
  });

  describe('GET /api/templates/:id', () => {
    it('returns 404 for non-existent id', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .get(`/api/templates/${fakeId}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(404);
    });

    it('returns 200 for existing template', async () => {
      const template = await seedTemplate({ name: 'T1' });

      const res = await request(app)
        .get(`/api/templates/${template._id}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('T1');
    });
  });
});
