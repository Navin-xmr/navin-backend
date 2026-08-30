/**
 * Telemetry anomaly detection tests.
 * Tests shock/GPS/temperature/humidity anomaly detection and telemetry record updates.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { Telemetry } from '../modules/telemetry/telemetry.model.js';
import { Shipment } from '../modules/shipments/shipments.model.js';
import { TelemetryThreshold } from '../modules/telemetry/telemetryThreshold.model.js';
import { detectTelemetryAnomalies } from './telemetryAnomalyDetection.js';
import { detectGpsLoss, GPS_LOSS_THRESHOLD } from './gpsLossDetection.js';
import { connectMongo, disconnectMongo } from '../infra/mongo/connection.js';

describe('Telemetry Anomaly Detection', () => {
  let shipmentId: string;
  let organizationId: string;

  beforeAll(async () => {
    await connectMongo(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/navin_test');

    // Create test organization and shipment
    organizationId = new mongoose.Types.ObjectId().toString();
    const shipmentDoc = await Shipment.create({
      referenceNumber: `TEST-${Date.now()}`,
      status: 'IN_TRANSIT',
      enterpriseId: organizationId,
      originLatitude: 0,
      originLongitude: 0,
      destLatitude: 10,
      destLongitude: 10,
    });
    shipmentId = shipmentDoc._id.toString();

    // Set custom thresholds for testing
    await TelemetryThreshold.findOneAndUpdate(
      { organizationId, shipmentType: 'DEFAULT' },
      {
        maxTemp: 25,
        minTemp: 5,
        maxHumidity: 80,
        minHumidity: 30,
        minBatteryLevel: 20,
      },
      { upsert: true }
    );
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  beforeEach(async () => {
    // Clear telemetry before each test
    await Telemetry.deleteMany({ shipmentId });
  });

  describe('Temperature Breach Detection', () => {
    it('should detect temperature exceeded anomaly', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 30, // exceeds 25°C threshold
        humidity: 50,
        latitude: 10,
        longitude: 20,
        batteryLevel: 80,
        timestamp: new Date(),
        dataHash: 'test-hash',
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        30,
        50,
        80,
        undefined,
        10,
        20
      );

      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyType).toBe('TEMPERATURE_BREACH');
      expect(result.details).toContain(expect.stringContaining('exceeded'));

      // Verify telemetry record was updated
      const updated = await Telemetry.findById(telemetryDoc._id);
      expect(updated?.isAnomaly).toBe(true);
      expect(updated?.anomalyType).toBe('TEMPERATURE_BREACH');
    });

    it('should detect temperature below minimum anomaly', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 2, // below 5°C threshold
        humidity: 50,
        latitude: 10,
        longitude: 20,
        batteryLevel: 80,
        timestamp: new Date(),
        dataHash: 'test-hash',
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        2,
        50,
        80,
        undefined,
        10,
        20
      );

      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyType).toBe('TEMPERATURE_BREACH');
      expect(result.details).toContain(expect.stringContaining('below'));
    });
  });

  describe('Humidity Breach Detection', () => {
    it('should detect humidity exceeded anomaly', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 85, // exceeds 80% threshold
        latitude: 10,
        longitude: 20,
        batteryLevel: 80,
        timestamp: new Date(),
        dataHash: 'test-hash',
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        20,
        85,
        80,
        undefined,
        10,
        20
      );

      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyType).toBe('HUMIDITY_BREACH');
      expect(result.details).toContain(expect.stringContaining('exceeded'));
    });

    it('should detect humidity below minimum anomaly', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 20, // below 30% threshold
        latitude: 10,
        longitude: 20,
        batteryLevel: 80,
        timestamp: new Date(),
        dataHash: 'test-hash',
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        20,
        20,
        80,
        undefined,
        10,
        20
      );

      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyType).toBe('HUMIDITY_BREACH');
      expect(result.details).toContain(expect.stringContaining('below'));
    });
  });

  describe('Shock Event Detection', () => {
    it('should detect shock event anomaly when magnitude > 2G', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 50,
        latitude: 10,
        longitude: 20,
        batteryLevel: 80,
        timestamp: new Date(),
        dataHash: 'test-hash',
        shockMagnitude: 3.5, // exceeds 2G threshold
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        20,
        50,
        80,
        3.5,
        10,
        20
      );

      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyType).toBe('SHOCK_EVENT');
      expect(result.details).toContain(expect.stringContaining('Shock'));
    });

    it('should not detect shock when magnitude <= 2G', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 50,
        latitude: 10,
        longitude: 20,
        batteryLevel: 80,
        timestamp: new Date(),
        dataHash: 'test-hash',
        shockMagnitude: 1.5,
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        20,
        50,
        80,
        1.5,
        10,
        20
      );

      expect(result.isAnomaly).toBe(false);
      expect(result.anomalyType).toBeUndefined();
    });
  });

  describe('Battery Low Detection', () => {
    it('should detect battery low anomaly', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 50,
        latitude: 10,
        longitude: 20,
        batteryLevel: 15, // below 20% threshold
        timestamp: new Date(),
        dataHash: 'test-hash',
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        20,
        50,
        15,
        undefined,
        10,
        20
      );

      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyType).toBe('BATTERY_LOW');
      expect(result.details).toContain(expect.stringContaining('Battery'));
    });
  });

  describe('GPS Loss Detection', () => {
    it('should not detect GPS loss with less than threshold readings', async () => {
      // Create 2 telemetry records without GPS
      await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 50,
        latitude: 0,
        longitude: 0,
        batteryLevel: 80,
        timestamp: new Date(Date.now() - 2000),
        dataHash: 'hash1',
        rawPayload: {},
      });

      const result = await detectGpsLoss(shipmentId, 0, 0);

      expect(result.hasGpsLoss).toBe(false);
      expect(result.consecutiveCount).toBeLessThan(GPS_LOSS_THRESHOLD);
    });

    it('should detect GPS loss with N consecutive missing readings', async () => {
      // Create GPS_LOSS_THRESHOLD records without coordinates
      for (let i = 0; i < GPS_LOSS_THRESHOLD; i++) {
        await Telemetry.create({
          shipmentId,
          temperature: 20,
          humidity: 50,
          latitude: 0,
          longitude: 0,
          batteryLevel: 80,
          timestamp: new Date(Date.now() - (GPS_LOSS_THRESHOLD - i) * 1000),
          dataHash: `hash-${i}`,
          rawPayload: {},
        });
      }

      const result = await detectGpsLoss(shipmentId, 0, 0);

      expect(result.hasGpsLoss).toBe(true);
      expect(result.consecutiveCount).toBeGreaterThanOrEqual(GPS_LOSS_THRESHOLD);
    });

    it('should integrate GPS loss into anomaly detection', async () => {
      // Create GPS_LOSS_THRESHOLD readings without valid coordinates
      for (let i = 0; i < GPS_LOSS_THRESHOLD; i++) {
        await Telemetry.create({
          shipmentId,
          temperature: 20,
          humidity: 50,
          latitude: 0,
          longitude: 0,
          batteryLevel: 80,
          timestamp: new Date(Date.now() - (GPS_LOSS_THRESHOLD - i) * 1000),
          dataHash: `hash-${i}`,
          rawPayload: {},
        });
      }

      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 50,
        latitude: 0,
        longitude: 0,
        batteryLevel: 80,
        timestamp: new Date(),
        dataHash: 'current-hash',
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        20,
        50,
        80,
        undefined,
        0,
        0
      );

      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyType).toBe('GPS_LOST');
    });
  });

  describe('Anomaly Priority', () => {
    it('should prioritize temperature breach over other anomalies', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 30, // exceeds threshold
        humidity: 50,
        latitude: 0,
        longitude: 0, // also missing GPS
        batteryLevel: 15, // also low battery
        timestamp: new Date(),
        dataHash: 'test-hash',
        shockMagnitude: 3, // also shock
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        30,
        50,
        15,
        3,
        0,
        0
      );

      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyType).toBe('TEMPERATURE_BREACH');
    });
  });

  describe('Normal Conditions', () => {
    it('should not flag anomaly when all readings are normal', async () => {
      const telemetryDoc = await Telemetry.create({
        shipmentId,
        temperature: 22,
        humidity: 55,
        latitude: 10,
        longitude: 20,
        batteryLevel: 85,
        timestamp: new Date(),
        dataHash: 'test-hash',
        rawPayload: {},
      });

      const result = await detectTelemetryAnomalies(
        telemetryDoc._id.toString(),
        shipmentId,
        22,
        55,
        85,
        undefined,
        10,
        20
      );

      expect(result.isAnomaly).toBe(false);
      expect(result.anomalyType).toBeUndefined();

      // Verify telemetry record was NOT updated with anomaly flags
      const updated = await Telemetry.findById(telemetryDoc._id);
      expect(updated?.isAnomaly).toBeFalsy();
      expect(updated?.anomalyType).toBeFalsy();
    });
  });
});
