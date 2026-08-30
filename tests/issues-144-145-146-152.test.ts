import request from 'supertest';
import { buildApp } from '../src/app.js';
import { connectMongo, disconnectMongo } from '../src/infra/mongo/connection.js';
import { UserModel, OrganizationModel } from '../src/modules/users/users.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import jwt from 'jsonwebtoken';
import { env } from '../src/env.js';

describe('Issues 144, 145, 146, 152 - Combined Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let adminToken: string;
  let orgId: string;

  beforeAll(async () => {
    await connectMongo(process.env.MONGO_URI!);
    app = buildApp();

    // Create test organization
    const org = await OrganizationModel.create({
      name: 'Test Org',
      type: 'ENTERPRISE',
    });
    orgId = org._id.toString();

    // Create admin user
    const adminUser = await UserModel.create({
      email: 'admin@test.com',
      name: 'Admin User',
      passwordHash: 'hashed',
      role: 'ADMIN',
      organizationId: orgId,
    });

    adminToken = jwt.sign({ userId: adminUser._id.toString(), role: 'ADMIN' }, env.JWT_SECRET, {
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await OrganizationModel.deleteMany({});
    await Shipment.deleteMany({});
    await disconnectMongo();
  });

  describe('Issue #144 - Request ID in Response Headers', () => {
    it('should return X-Request-ID header in all responses', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['x-request-id']).toBeDefined();
      expect(typeof response.headers['x-request-id']).toBe('string');
      expect(response.headers['x-request-id'].length).toBeGreaterThan(0);
    });

    it('should use provided X-Request-ID if sent in request', async () => {
      const customRequestId = 'custom-request-id-12345';
      const response = await request(app).get('/api/health').set('x-request-id', customRequestId);

      expect(response.headers['x-request-id']).toBe(customRequestId);
    });

    it('should generate unique X-Request-ID for each request', async () => {
      const response1 = await request(app).get('/api/health');
      const response2 = await request(app).get('/api/health');

      expect(response1.headers['x-request-id']).toBeDefined();
      expect(response2.headers['x-request-id']).toBeDefined();
      expect(response1.headers['x-request-id']).not.toBe(response2.headers['x-request-id']);
    });
  });

  describe('Issue #145 - organizationId Optional in Signup', () => {
    it('should allow signup without organizationId', async () => {
      const response = await request(app).post('/api/auth/signup').send({
        email: 'newuser@test.com',
        name: 'New User',
        password: 'password123',
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
    });

    it('should allow signup with organizationId', async () => {
      const response = await request(app).post('/api/auth/signup').send({
        email: 'newuser2@test.com',
        name: 'New User 2',
        password: 'password123',
        organizationId: orgId,
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject signup with missing required fields', async () => {
      const response = await request(app).post('/api/auth/signup').send({
        email: 'incomplete@test.com',
        // missing name and password
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Issue #146 - Password Minimum 8 Characters', () => {
    it('should reject password with less than 8 characters', async () => {
      const response = await request(app).post('/api/auth/signup').send({
        email: 'shortpass@test.com',
        name: 'Short Pass User',
        password: 'pass123', // 7 characters
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('8 characters');
    });

    it('should accept password with exactly 8 characters', async () => {
      const response = await request(app).post('/api/auth/signup').send({
        email: 'eightchar@test.com',
        name: 'Eight Char User',
        password: 'pass1234', // 8 characters
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should accept password with more than 8 characters', async () => {
      const response = await request(app).post('/api/auth/signup').send({
        email: 'longpass@test.com',
        name: 'Long Pass User',
        password: 'password12345', // 13 characters
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Issue #152 - Offset-based Pagination for Shipments', () => {
    beforeAll(async () => {
      // Create test shipments
      const shipments = [];
      for (let i = 1; i <= 25; i++) {
        shipments.push({
          trackingNumber: `TEST-${i.toString().padStart(3, '0')}`,
          origin: `Origin ${i}`,
          destination: `Destination ${i}`,
          enterpriseId: orgId,
          logisticsId: orgId,
          status: 'CREATED',
        });
      }
      await Shipment.insertMany(shipments);
    });

    afterAll(async () => {
      await Shipment.deleteMany({ trackingNumber: /^TEST-/ });
    });

    it('should return shipments with page, limit, and total in meta', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.meta).toHaveProperty('page');
      expect(response.body.meta).toHaveProperty('limit');
      expect(response.body.meta).toHaveProperty('total');
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.limit).toBe(10);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
    });

    it('should return correct page 2 results', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 2, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.meta.page).toBe(2);
      expect(response.body.meta.limit).toBe(10);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
    });

    it('should handle page beyond available data', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 100, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(0);
      expect(response.body.meta.page).toBe(100);
    });

    it('should default to page 1 and limit 20 when not specified', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.limit).toBe(20);
    });

    it('should respect custom limit parameter', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.meta.limit).toBe(5);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should return total count of all shipments', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBeGreaterThanOrEqual(25);
      expect(typeof response.body.meta.total).toBe('number');
    });

    it('should work with status filter and pagination', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10, status: 'CREATED' });

      expect(response.status).toBe(200);
      expect(response.body.meta.page).toBe(1);
      expect(response.body.data.every((s: { status: string }) => s.status === 'CREATED')).toBe(
        true
      );
    });

    it('should reject invalid page numbers', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 0, limit: 10 });

      expect(response.status).toBe(400);
    });

    it('should reject limit exceeding maximum', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 101 });

      expect(response.status).toBe(400);
    });
  });
});
