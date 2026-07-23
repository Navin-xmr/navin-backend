import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import process from 'process';
import type { Application } from 'express';

type OrganizationRecord = {
  _id: string;
  name: string;
  type: string;
  settings?: Record<string, unknown>;
  deletedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

const organizationsData: OrganizationRecord[] = [];

await jest.unstable_mockModule('../src/modules/organizations/organizations.model.js', () => {
  const OrganizationModel = {
    create: (doc: OrganizationRecord) => {
      const org = { ...doc, _id: String(organizationsData.length + 1), createdAt: new Date(), updatedAt: new Date() };
      organizationsData.push(org);
      return Promise.resolve(org);
    },
    find: () => {
      return {
        sort: () => ({
          lean: () => Promise.resolve(organizationsData),
        }),
        lean: () => Promise.resolve(organizationsData),
      };
    },
    findById: (id: string) => {
      const found = organizationsData.find(o => String(o._id) === String(id));
      return Promise.resolve(found ?? null);
    },
    findByIdAndUpdate: (id: string, update: Record<string, unknown>) => {
      const idx = organizationsData.findIndex(o => String(o._id) === String(id));
      if (idx === -1) return Promise.resolve(null);
      organizationsData[idx] = { ...organizationsData[idx], ...update } as OrganizationRecord;
      return Promise.resolve(organizationsData[idx]);
    },
    countDocuments: () => Promise.resolve(organizationsData.length),
    deleteMany: () => {
      organizationsData.length = 0;
      return Promise.resolve();
    },
  };

  const OrganizationType = {
    ENTERPRISE: 'ENTERPRISE',
    LOGISTICS: 'LOGISTICS',
  };

  return { OrganizationModel, OrganizationType };
});

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: { create: jest.fn() },
  OrganizationType: { ENTERPRISE: 'ENTERPRISE', LOGISTICS: 'LOGISTICS' },
}));

describe('Organizations API', () => {
  let app: Application;
  let buildApp: () => Application;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    buildApp = appModule.buildApp as () => Application;
    app = buildApp();
  });

  beforeEach(async () => {
    organizationsData.length = 0;
  });

  const generateToken = (payload: { userId?: string; role?: string; organizationId?: string }) =>
    jwt.sign(payload, process.env.JWT_SECRET!);

  describe('POST /api/organizations', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app)
        .post('/api/organizations')
        .send({ name: 'Test Org', type: 'ENTERPRISE' });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });
      const res = await request(app)
        .post('/api/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test Org', type: 'ENTERPRISE' });
      expect(res.status).toBe(403);
    });

    it('should create organization for SUPER_ADMIN', async () => {
      const token = generateToken({ userId: 'super-1', role: 'SUPER_ADMIN' });
      const res = await request(app)
        .post('/api/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test Enterprise', type: 'ENTERPRISE' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Test Enterprise');
      expect(res.body.data.type).toBe('ENTERPRISE');
    });

    it('should return 409 if organization already exists', async () => {
      organizationsData.push({ _id: '1', name: 'Existing Org', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken({ userId: 'super-1', role: 'SUPER_ADMIN' });
      const res = await request(app)
        .post('/api/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Existing Org', type: 'ENTERPRISE' });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/organizations', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/organizations');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });
      const res = await request(app)
        .get('/api/organizations')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('should list all organizations for SUPER_ADMIN', async () => {
      organizationsData.push(
        { _id: '1', name: 'Org A', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() },
        { _id: '2', name: 'Org B', type: 'LOGISTICS', createdAt: new Date(), updatedAt: new Date() }
      );

      const token = generateToken({ userId: 'super-1', role: 'SUPER_ADMIN' });
      const res = await request(app)
        .get('/api/organizations')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/organizations/:id', () => {
    it('should return 404 for non-existent organization', async () => {
      const token = generateToken({ userId: 'super-1', role: 'SUPER_ADMIN' });
      const res = await request(app)
        .get('/api/organizations/nonexistent')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('should return 403 for ADMIN accessing another organization', async () => {
      organizationsData.push({ _id: '1', name: 'Org A', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org2' });
      const res = await request(app)
        .get('/api/organizations/1')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('should allow ADMIN to read their own organization', async () => {
      organizationsData.push({ _id: '1', name: 'Org A', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: '1' });
      const res = await request(app)
        .get('/api/organizations/1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Org A');
    });

    it('should allow SUPER_ADMIN to read any organization', async () => {
      organizationsData.push({ _id: '1', name: 'Org A', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken({ userId: 'super-1', role: 'SUPER_ADMIN' });
      const res = await request(app)
        .get('/api/organizations/1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Org A');
    });
  });

  describe('PATCH /api/organizations/:id', () => {
    it('should update organization for ADMIN on their own org', async () => {
      organizationsData.push({ _id: '1', name: 'Org A', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: '1' });
      const res = await request(app)
        .patch('/api/organizations/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
    });

    it('should prevent ADMIN from updating type', async () => {
      organizationsData.push({ _id: '1', name: 'Org A', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: '1' });
      await request(app)
        .patch('/api/organizations/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'LOGISTICS' });

      const org = organizationsData.find(o => o._id === '1');
      expect(org?.type).toBe('ENTERPRISE');
    });

    it('should allow SUPER_ADMIN to update any field', async () => {
      organizationsData.push({ _id: '1', name: 'Org A', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken({ userId: 'super-1', role: 'SUPER_ADMIN' });
      const res = await request(app)
        .patch('/api/organizations/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'LOGISTICS' });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/organizations/:id', () => {
    it('should return 403 for ADMIN role', async () => {
      const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });
      const res = await request(app)
        .delete('/api/organizations/1')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('should delete organization for SUPER_ADMIN', async () => {
      organizationsData.push({ _id: '1', name: 'Org A', type: 'ENTERPRISE', createdAt: new Date(), updatedAt: new Date() });

      const token = generateToken({ userId: 'super-1', role: 'SUPER_ADMIN' });
      const res = await request(app)
        .delete('/api/organizations/1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(organizationsData.find(o => o._id === '1')?.deletedAt).toBeDefined();
    });
  });
});