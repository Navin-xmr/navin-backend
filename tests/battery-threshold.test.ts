import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import { connectMongo } from '../src/infra/mongo/connection.js';
import { Anomaly } from '../src/modules/anomaly/anomaly.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';
import { UserModel } from '../src/modules/users/users.model.js';
import { env } from '../src/env.js';
import { detectAnomaly } from '../src/modules/anomaly/anomaly.service.js';
import { evaluateTelemetry } from '../src/services/anomaly.service.js';

const app = buildApp();

let adminToken: string;

beforeAll(async () => {
  await connectMongo(process.env.MONGO_URI!);
  // Create a test admin user
  const adminUser = await UserModel.create({
    email: 'battery-test-admin@test.com',
    name: 'Battery Test Admin',
    passwordHash: 'hashed',
    role: 'ADMIN',
    organizationId: '507f1f77bcf86cd799439011',
  });
  adminToken = jwt.sign(
    { userId: adminUser._id.toString(), role: 'ADMIN', organizationId: '507f1f77bcf86cd799439011' },
    env.JWT_SECRET
  );
});

afterEach(async () => {
  await Anomaly.deleteMany({});
  await Telemetry.deleteMany({});
  await Shipment.deleteMany({});
  await UserModel.deleteMany({ email: { $in: ['battery-test-admin@test.com', 'low-priv-user@test.com'] } });
});

describe('Issue #168: Battery Threshold Detection at 20%', () => {
  describe('Core anomaly evaluation logic', () => {
    it('should NOT trigger BATTERY_LOW anomaly when battery is above 20%', () => {
      const thresholds = { minBatteryLevel: 20 };

      // Test at 21%
      const result21 = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 21,
        },
        thresholds
      );
      expect(result21).toHaveLength(0);

      // Test at 25%
      const result25 = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 25,
        },
        thresholds
      );
      expect(result25).toHaveLength(0);

      // Test at 100%
      const result100 = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 100,
        },
        thresholds
      );
      expect(result100).toHaveLength(0);
    });

    it('should trigger BATTERY_LOW anomaly when battery is at exactly 20%', () => {
      const thresholds = { minBatteryLevel: 20 };

      const result = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 20,
        },
        thresholds
      );

      // At exactly 20%, no anomaly is triggered (threshold is exclusive)
      expect(result).toHaveLength(0);
    });

    it('should trigger BATTERY_LOW anomaly when battery is below 20%', () => {
      const thresholds = { minBatteryLevel: 20 };

      // Test at 19%
      const result19 = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 19,
        },
        thresholds
      );
      expect(result19).toHaveLength(1);
      expect(result19[0].type).toBe('BATTERY_LOW');
      expect(result19[0].severity).toBe('MEDIUM');

      // Test at 10%
      const result10 = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 10,
        },
        thresholds
      );
      expect(result10).toHaveLength(1);
      expect(result10[0].type).toBe('BATTERY_LOW');
      expect(result10[0].severity).toBe('MEDIUM');
    });

    it('should determine battery severity correctly', () => {
      const thresholds = { minBatteryLevel: 20 };

      // Between 10% and 20% (20 * 0.5) -> MEDIUM severity
      const resultMedium = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 15,
        },
        thresholds
      );
      expect(resultMedium).toHaveLength(1);
      expect(resultMedium[0].severity).toBe('MEDIUM');

      // Below 10% (20 * 0.5) -> HIGH severity
      const resultHigh = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 9,
        },
        thresholds
      );
      expect(resultHigh).toHaveLength(1);
      expect(resultHigh[0].severity).toBe('HIGH');

      // At 1% -> HIGH severity
      const resultVeryLow = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 1,
        },
        thresholds
      );
      expect(resultVeryLow).toHaveLength(1);
      expect(resultVeryLow[0].severity).toBe('HIGH');
    });

    it('should handle null/undefined battery levels gracefully', () => {
      const thresholds = { minBatteryLevel: 20 };

      // Null battery level
      const resultNull = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: null as any,
        },
        thresholds
      );
      expect(resultNull).toHaveLength(0);

      // Undefined battery level
      const resultUndefined = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: undefined as any,
        },
        thresholds
      );
      expect(resultUndefined).toHaveLength(0);
    });
  });

  describe('Anomaly detection service', () => {
    it('should create BATTERY_LOW anomaly in database when battery is below 20%', async () => {
      const shipment = await Shipment.create({
        trackingNumber: 'BATTERY-TEST-001',
        origin: 'Warehouse A',
        destination: 'Store B',
        enterpriseId: '507f1f77bcf86cd799439011',
        logisticsId: '507f1f77bcf86cd799439012',
      });

      const result = await detectAnomaly({
        _id: 'sensor-001',
        shipmentId: shipment._id.toString(),
        temperature: 20,
        humidity: 50,
        batteryLevel: 19,
      });

      expect(result.detected).toBe(true);
      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0]).toMatchObject({
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        shipmentId: shipment._id.toString(),
      });

      // Verify it was saved to the database
      const saved = await Anomaly.findOne({ shipmentId: shipment._id, type: 'BATTERY_LOW' });
      expect(saved).toBeDefined();
      expect(saved?.severity).toBe('MEDIUM');
      expect(saved?.resolved).toBe(false);
    });

    it('should create multiple anomalies when both battery and temperature exceed thresholds', async () => {
      const shipment = await Shipment.create({
        trackingNumber: 'BATTERY-TEST-002',
        origin: 'Warehouse A',
        destination: 'Store B',
        enterpriseId: '507f1f77bcf86cd799439011',
        logisticsId: '507f1f77bcf86cd799439012',
      });

      const result = await detectAnomaly({
        _id: 'sensor-002',
        shipmentId: shipment._id.toString(),
        temperature: 30, // Exceeds 25 threshold
        humidity: 50,
        batteryLevel: 15, // Below 20 threshold
      });

      expect(result.detected).toBe(true);
      expect(result.anomalies).toHaveLength(2);

      const types = result.anomalies.map(a => a.type);
      expect(types).toContain('BATTERY_LOW');
      expect(types).toContain('TEMPERATURE_EXCEEDED');
    });
  });

  describe('API endpoints for anomaly retrieval and resolution', () => {
    it('should retrieve battery anomalies via GET /api/anomalies', async () => {
      const shipment = await Shipment.create({
        trackingNumber: 'BATTERY-TEST-003',
        origin: 'Warehouse A',
        destination: 'Store B',
        enterpriseId: '507f1f77bcf86cd799439011',
        logisticsId: '507f1f77bcf86cd799439012',
      });

      await Anomaly.create({
        shipmentId: shipment._id,
        timestamp: new Date(),
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Battery level below threshold: 15 < 20',
        resolved: false,
      });

      const res = await request(app)
        .get('/api/anomalies')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        resolved: false,
      });
    });

    it('should filter battery anomalies by severity', async () => {
      const shipment = await Shipment.create({
        trackingNumber: 'BATTERY-TEST-004',
        origin: 'Warehouse A',
        destination: 'Store B',
        enterpriseId: '507f1f77bcf86cd799439011',
        logisticsId: '507f1f77bcf86cd799439012',
      });

      // Create MEDIUM severity anomaly
      await Anomaly.create({
        shipmentId: shipment._id,
        timestamp: new Date(),
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Battery at 15%',
        resolved: false,
      });

      // Create HIGH severity anomaly
      await Anomaly.create({
        shipmentId: shipment._id,
        timestamp: new Date(Date.now() + 1000),
        type: 'BATTERY_LOW',
        severity: 'HIGH',
        message: 'Battery at 5%',
        resolved: false,
      });

      const res = await request(app)
        .get('/api/anomalies?severity=HIGH')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].severity).toBe('HIGH');
    });

    it('should resolve battery anomaly via PATCH /api/anomalies/:id/resolve', async () => {
      const shipment = await Shipment.create({
        trackingNumber: 'BATTERY-TEST-005',
        origin: 'Warehouse A',
        destination: 'Store B',
        enterpriseId: '507f1f77bcf86cd799439011',
        logisticsId: '507f1f77bcf86cd799439012',
      });

      const anomaly = await Anomaly.create({
        shipmentId: shipment._id,
        timestamp: new Date(),
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Battery at 20%',
        resolved: false,
      });

      const res = await request(app)
        .patch(`/api/anomalies/${anomaly._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.resolved).toBe(true);

      const updated = await Anomaly.findById(anomaly._id);
      expect(updated?.resolved).toBe(true);
    });

    it('should require ADMIN or MANAGER role to access anomalies', async () => {
      // Create a user without proper role
      const lowPrivUser = await UserModel.create({
        email: 'low-priv-user@test.com',
        name: 'Low Priv User',
        passwordHash: 'hashed',
        role: 'VIEWER',
        organizationId: '507f1f77bcf86cd799439011',
      });

      const lowPrivToken = jwt.sign(
        { userId: lowPrivUser._id.toString(), role: 'VIEWER', organizationId: '507f1f77bcf86cd799439011' },
        env.JWT_SECRET
      );

      const res = await request(app)
        .get('/api/anomalies')
        .set('Authorization', `Bearer ${lowPrivToken}`);

      expect(res.status).toBe(403);

      await UserModel.deleteOne({ _id: lowPrivUser._id });
    });

    it('should return 401 when missing authentication token', async () => {
      const res = await request(app).get('/api/anomalies');

      expect(res.status).toBe(401);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle invalid shipment ID gracefully', async () => {
      const result = await detectAnomaly({
        _id: 'sensor-invalid',
        shipmentId: '', // Empty shipmentId
        temperature: 15,
        humidity: 50,
        batteryLevel: 15,
      });

      // Should return no anomalies for invalid shipmentId
      expect(result.detected).toBe(false);
      expect(result.anomalies).toHaveLength(0);
    });

    it('should handle NaN timestamp gracefully', () => {
      const thresholds = { minBatteryLevel: 20 };

      const result = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(NaN),
          temperature: 20,
          humidity: 50,
          batteryLevel: 15,
        },
        thresholds
      );

      expect(result).toHaveLength(0);
    });

    it('should handle battery level edge cases (0%, 100%)', () => {
      const thresholds = { minBatteryLevel: 20 };

      // 0% battery
      const result0 = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 0,
        },
        thresholds
      );
      expect(result0).toHaveLength(1);
      expect(result0[0].severity).toBe('HIGH'); // 0 < 10 (20 * 0.5)

      // 100% battery
      const result100 = evaluateTelemetry(
        {
          shipmentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          temperature: 20,
          humidity: 50,
          batteryLevel: 100,
        },
        thresholds
      );
      expect(result100).toHaveLength(0);
    });
  });
});
