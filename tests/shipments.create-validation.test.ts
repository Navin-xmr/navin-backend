/** @see issue-#155 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import type { Application } from 'express';
import { seedAuthShipmentSuite, cleanupAuthShipmentSuite } from './helpers/authShipmentSuite.js';

describe('Issue #155 - Optional trackingNumber in CreateShipment validation', () => {
  let app: Application;
  let testOrgId: string;
  let managerToken: string;

  beforeAll(async () => {
    ({ app, testOrgId, managerToken } = await seedAuthShipmentSuite());
  }, 120_000);

  afterAll(cleanupAuthShipmentSuite);

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

      // Empty trackingNumber is treated as omitted and auto-generated
      expect(res.status).toBe(201);
      expect(res.body.data.trackingNumber).toMatch(/^NVN-\d{6}$/);
    });
  });
});
