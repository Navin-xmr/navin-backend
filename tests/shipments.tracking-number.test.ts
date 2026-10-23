/** @see issue-#154 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import type { Application } from 'express';
import { seedAuthShipmentSuite, cleanupAuthShipmentSuite } from './helpers/authShipmentSuite.js';

describe('Issue #154 - Automatic shipment tracking number generation', () => {
  let app: Application;
  let testOrgId: string;
  let managerToken: string;

  beforeAll(async () => {
    ({ app, testOrgId, managerToken } = await seedAuthShipmentSuite());
  }, 120_000);

  afterAll(cleanupAuthShipmentSuite);

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
});
