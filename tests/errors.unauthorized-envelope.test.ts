/** @see issue-#150 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { signToken } from './fixtures/factories.js';
import type { Application } from 'express';
import { seedAuthShipmentSuite, cleanupAuthShipmentSuite } from './helpers/authShipmentSuite.js';

describe('Issue #150 - Standardize HTTP 401 response envelopes', () => {
  let app: Application;
  let testOrgId: string;

  beforeAll(async () => {
    ({ app, testOrgId } = await seedAuthShipmentSuite());
  }, 120_000);

  afterAll(cleanupAuthShipmentSuite);

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
      const expiredToken = signToken({ userId: 'test-user', role: 'VIEWER' }, { expiresIn: '-1h' });

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
});
