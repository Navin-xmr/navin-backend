/**
 * @see issue-#147
 * @see issue-#754
 *
 * Security decision (#147, Option A): manual signup ALWAYS assigns the VIEWER
 * role, regardless of the email domain. Role elevation is invitation- and
 * administration-only and is never inferred from an email domain.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import type { Application } from 'express';
import { seedAuthShipmentSuite, cleanupAuthShipmentSuite } from './helpers/authShipmentSuite.js';

describe('Issue #147 - Auto-assign default user role during manual signup', () => {
  let app: Application;
  let testOrgId: string;

  beforeAll(async () => {
    ({ app, testOrgId } = await seedAuthShipmentSuite());
  }, 120_000);

  afterAll(cleanupAuthShipmentSuite);

  describe('Issue #147: Auto-assign default user role during manual signup', () => {
    // Elevation is invitation/administration-only; a privileged-looking domain
    // must NOT grant ADMIN at signup.
    it('should assign VIEWER role to users with admin email domains', async () => {
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
      expect(res.body.data.user.role).toBe('VIEWER');
      expect(res.body.data.token).toBeDefined();
    });

    it('should assign VIEWER role to users with navin-admin.com domain', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'admin@navin-admin.com',
          name: 'Admin User 2',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('VIEWER');
    });

    it('should assign VIEWER role to users with admin.navin.io domain', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'user@admin.navin.io',
          name: 'Admin User 3',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('VIEWER');
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

    // Explicit roles in the signup body are ignored (#147 Option A, #756):
    // unauthenticated signup can never escalate; elevation is
    // invitation/administration-only.
    it('should ignore an explicit role in the signup body and assign VIEWER', async () => {
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
      expect(res.body.data.user.role).toBe('VIEWER');
    });

    it('should handle edge case: missing organizationId gracefully', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'noorg@example.com',
          name: 'No Org User',
          password: 'password123',
        });

      // organizationId is optional on signup; omitting it succeeds with 201
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });
});
