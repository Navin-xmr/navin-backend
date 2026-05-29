/**
 * Integration tests for Issues #147, #150, #154, #155
 * 
 * Issue #147: Auto-assign default user role during manual signup
 * Issue #150: Standardize HTTP 401 response envelopes in Error Middleware
 * Issue #154: Integrate automatic Shipment Tracking Number generation
 * Issue #155: Make trackingNumber optional in CreateShipment validation
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import type { Application } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel, OrganizationModel } from '../src/modules/users/users.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';

describe('Issues #147, #150, #154, #155 - Integration Tests', () => {
  let app: Application;
  let testOrgId: string;
  let adminToken: string;
  let managerToken: string;

  beforeAll(async () => {
    // Import app
    const { buildApp } = await import('../src/app.js');
    app = buildApp();

    // Create test organization
    const org = await OrganizationModel.create({
      name: 'Test Org Issues',
      type: 'ENTERPRISE',
    });
    testOrgId = org._id.toString();

    // Create admin user for testing
    const adminUser = await UserModel.create({
      email: 'admin@navin.io',
      name: 'Admin User',
      passwordHash: 'hashedpassword',
      role: 'ADMIN',
      organizationId: testOrgId,
    });

    // Create manager user for testing
    const managerUser = await UserModel.create({
      email: 'manager@test.com',
      name: 'Manager User',
      passwordHash: 'hashedpassword',
      role: 'MANAGER',
      organizationId: testOrgId,
    });

    adminToken = jwt.sign(
      { userId: adminUser._id.toString(), role: 'ADMIN', organizationId: testOrgId },
      process.env.JWT_SECRET!
    );

    managerToken = jwt.sign(
      { userId: managerUser._id.toString(), role: 'MANAGER', organizationId: testOrgId },
      process.env.JWT_SECRET!
    );
  });

  afterAll(async () => {
    await UserModel.deleteMany({ email: { $regex: /test|navin\.io/ } });
    await OrganizationModel.deleteMany({ name: /Test/ });
    await Shipment.deleteMany({ trackingNumber: { $regex: /^NVN-/ } });
  });

  describe('Issue #147: Auto-assign default user role during manual signup', () => {
    it('should assign ADMIN role to users with admin email domains', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'newadmin@navin.io',
          name: 'New Admin',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe('ADMIN');
      expect(res.body.data.token).toBeDefined();
    });

    it('should assign ADMIN role to users with navin-admin.com domain', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'admin@navin-admin.com',
          name: 'Admin User 2',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('ADMIN');
    });

    it('should assign ADMIN role to users with admin.navin.io domain', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'user@admin.navin.io',
          name: 'Admin User 3',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('ADMIN');
    });

    it('should assign VIEWER role to standard registrations by default', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'viewer@example.com',
          name: 'Standard User',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe('VIEWER');
    });

    it('should allow explicit role assignment when provided', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'custom@example.com',
          name: 'Custom Role User',
          password: 'password123',
          organizationId: testOrgId,
          role: 'MANAGER',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('MANAGER');
    });

    it('should handle edge case: missing organizationId gracefully', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'noorg@example.com',
          name: 'No Org User',
          password: 'password123',
        });

      // Should either succeed with default org or fail with validation error
      expect([201, 400, 422]).toContain(res.status);
    });
  });

  describe('Issue #150: Standardize HTTP 401 response envelopes', () => {
    it('should return standardized 401 response with data: null when no auth header', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .send({
          origin: 'Test',
          destination: 'Test',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBeDefined();
      expect(res.body.data).toBe(null);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('ERR_AUTH_INVALID');
    });

    it('should return standardized 401 response with errorCode when invalid token', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', 'Bearer invalid-token-here')
        .send({
          origin: 'Test',
          destination: 'Test',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBe(null);
      expect(res.body.error.code).toBe('ERR_AUTH_INVALID');
    });

    it('should return standardized 401 response for expired token', async () => {
      const expiredToken = jwt.sign(
        { userId: 'test-user', role: 'VIEWER' },
        process.env.JWT_SECRET!,
        { expiresIn: '-1h' }
      );

      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({
          origin: 'Test',
          destination: 'Test',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBe(null);
      expect(res.body.error.code).toBe('ERR_AUTH_INVALID');
    });

    it('should include distinct errorCode parameter in 401 responses', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .send({
          origin: 'Test Origin',
          destination: 'Test Destination',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('ERR_AUTH_INVALID');
      expect(typeof res.body.error.code).toBe('string');
    });
  });

  describe('Issue #154: Integrate automatic Shipment Tracking Number generation', () => {
    it('should auto-generate tracking number when omitted', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          origin: 'New York',
          destination: 'Los Angeles',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trackingNumber).toBeDefined();
      expect(res.body.data.trackingNumber).toMatch(/^NVN-\d{6}$/);
    });

    it('should generate unique tracking numbers for multiple shipments', async () => {
      const res1 = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          origin: 'Chicago',
          destination: 'Miami',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      const res2 = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          origin: 'Seattle',
          destination: 'Boston',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.data.trackingNumber).toBeDefined();
      expect(res2.body.data.trackingNumber).toBeDefined();
      expect(res1.body.data.trackingNumber).not.toBe(res2.body.data.trackingNumber);
    });

    it('should save auto-generated tracking number to database', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          origin: 'Dallas',
          destination: 'Houston',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(201);
      const trackingNumber = res.body.data.trackingNumber;

      // Verify in database
      const shipment = await Shipment.findOne({ trackingNumber });
      expect(shipment).toBeDefined();
      expect(shipment?.trackingNumber).toBe(trackingNumber);
    });

    it('should use provided tracking number when supplied', async () => {
      const customTracking = 'CUSTOM-12345';
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          trackingNumber: customTracking,
          origin: 'Phoenix',
          destination: 'Denver',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.trackingNumber).toBe(customTracking);
    });
  });

  describe('Issue #155: Make trackingNumber optional in CreateShipment validation', () => {
    it('should pass Zod validation without trackingNumber in payload', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          origin: 'Atlanta',
          destination: 'Nashville',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Shipment created');
    });

    it('should return 201 OK when trackingNumber is omitted', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          origin: 'Portland',
          destination: 'San Francisco',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.trackingNumber).toMatch(/^NVN-\d{6}$/);
    });

    it('should still validate other required fields', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          // Missing origin and destination
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should handle edge case: empty string trackingNumber', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          trackingNumber: '',
          origin: 'Austin',
          destination: 'San Antonio',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      // Should either auto-generate or fail validation
      expect([201, 400]).toContain(res.status);
    });
  });

  describe('Combined functionality: All 4 issues working together', () => {
    it('should create shipment with auto-generated tracking number by admin user with auto-assigned role', async () => {
      // First, signup a new admin user (Issue #147)
      const signupRes = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'combined@navin.io',
          name: 'Combined Test Admin',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(signupRes.status).toBe(201);
      expect(signupRes.body.data.user.role).toBe('ADMIN');

      const newAdminToken = signupRes.body.data.token;

      // Now create a shipment without tracking number (Issues #154, #155)
      const shipmentRes = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${newAdminToken}`)
        .send({
          origin: 'Combined Test Origin',
          destination: 'Combined Test Destination',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(shipmentRes.status).toBe(201);
      expect(shipmentRes.body.data.trackingNumber).toMatch(/^NVN-\d{6}$/);
    });

    it('should return proper 401 error structure when unauthorized user tries to create shipment', async () => {
      const res = await request(app)
        .post('/api/shipments')
        .send({
          origin: 'Test',
          destination: 'Test',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      // Issue #150: Standardized 401 response
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBe(null);
      expect(res.body.error.code).toBe('ERR_AUTH_INVALID');
    });
  });
});
