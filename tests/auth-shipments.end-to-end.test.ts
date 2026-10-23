/**
 * @see issue-#150
 * @see issue-#154
 * @see issue-#155
 * @see issue-#755
 *
 * Issue #755: this suite previously expected public signup to hand out the
 * ADMIN role to a `@navin.io` address. That contradicts the settled VIEWER-
 * always signup policy (#147 Option A) — role elevation is invitation- and
 * administration-only. The privileged actor for the shipment flow is now
 * provisioned through the supported invitation flow (SUPER_ADMIN invites an
 * ADMIN), while a negative assertion proves ordinary signup cannot elevate.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import type { Application } from 'express';
import { seedAuthShipmentSuite, cleanupAuthShipmentSuite } from './helpers/authShipmentSuite.js';

describe('Issues #150, #154, #155, #755 - Shipment flow behind invitation-based elevation', () => {
  let app: Application;
  let testOrgId: string;
  let superAdminToken: string;

  beforeAll(async () => {
    ({ app, testOrgId, superAdminToken } = await seedAuthShipmentSuite());
  }, 120_000);

  afterAll(cleanupAuthShipmentSuite);

  describe('Shipment flow with an invitation-provisioned ADMIN', () => {
    it('elevates a fresh invitee to ADMIN via the invitation flow, who then creates a shipment with an auto-generated tracking number', async () => {
      // Step 1: elevation happens through the supported flow — a SUPER_ADMIN
      // invites a fresh (never-signed-up) email with the ADMIN role. Inviting an
      // existing account is rejected (409), so signup cannot be the carrier.
      const invitationRes = await request(app)
        .post('/api/company/invitations')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ email: 'invited-admin@navin.io', role: 'ADMIN' });

      expect(invitationRes.status).toBe(201);
      const invitationToken: string = invitationRes.body.data.token;
      expect(invitationToken).toBeDefined();

      // Step 3: the invitee accepts, which provisions the ADMIN account.
      const acceptRes = await request(app).post('/api/company/invitations/accept').send({
        token: invitationToken,
        name: 'Combined Test Admin',
        password: 'password123',
      });

      expect(acceptRes.status).toBe(201);
      expect(acceptRes.body.data.user.role).toBe('ADMIN');

      // Step 4: log in as the newly elevated ADMIN to exercise the live
      // authentication path rather than reusing a seeded token.
      const loginRes = await request(app).post('/api/auth/login').send({
        email: 'invited-admin@navin.io',
        password: 'password123',
      });

      expect(loginRes.status).toBe(200);
      const adminToken: string = loginRes.body.data.token;
      expect(adminToken).toBeDefined();

      // Step 5: the authorized actor creates a shipment without a tracking
      // number (Issues #154, #155).
      const shipmentRes = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          origin: 'Combined Test Origin',
          destination: 'Combined Test Destination',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      expect(shipmentRes.status).toBe(201);
      expect(shipmentRes.body.data.trackingNumber).toMatch(/^NVN-\d{6}$/);
    });

    it('rejects shipment creation for a plain signup VIEWER (signup cannot self-elevate)', async () => {
      // Negative assertion: ordinary signup yields VIEWER regardless of the
      // privileged-looking email domain (#755 acceptance criteria).
      const signupRes = await request(app).post('/api/auth/signup').send({
        email: 'combined@navin.io',
        name: 'Combined Test Admin',
        password: 'password123',
        organizationId: testOrgId,
      });

      expect(signupRes.status).toBe(201);
      expect(signupRes.body.data.user.role).toBe('VIEWER');

      const viewerToken: string = signupRes.body.data.token;
      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          origin: 'Test',
          destination: 'Test',
          enterpriseId: testOrgId,
          logisticsId: testOrgId,
        });

      // POST /api/shipments requires ADMIN/MANAGER (shipments.routes.ts:124) —
      // a signup-only VIEWER must be denied, proving no elevation happened.
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ERR_PERMISSION_DENIED');
    });
  });

  describe('Standardized error contract (Issue #150)', () => {
    it('should return proper 401 error structure when unauthorized user tries to create shipment', async () => {
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
      expect(res.body.data).toBe(null);
      expect(res.body.error.code).toBe('ERR_AUTH_INVALID');
    });
  });
});
