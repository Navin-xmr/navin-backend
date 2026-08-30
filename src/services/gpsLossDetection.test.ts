/**
 * GPS loss detection tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Telemetry } from '../modules/telemetry/telemetry.model.js';
import { Shipment } from '../modules/shipments/shipments.model.js';
import { detectGpsLoss, GPS_LOSS_THRESHOLD } from './gpsLossDetection.js';
import { connectMongo, disconnectMongo } from '../infra/mongo/connection.js';

describe('GPS Loss Detection', () => {
  let shipmentId: string;

  beforeAll(async () => {
    await connectMongo(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/navin_test');

    // Create test shipment
    const shipmentDoc = await Shipment.create({
      referenceNumber: `GPS-TEST-${Date.now()}`,
      status: 'IN_TRANSIT',
      originLatitude: 0,
      originLongitude: 0,
      destLatitude: 10,
      destLongitude: 10,
    });
    shipmentId = shipmentDoc._id.toString();
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  beforeEach(async () => {
    await Telemetry.deleteMany({ shipmentId });
  });

  describe('Valid Coordinates', () => {
    it('should detect valid coordinates', async () => {
      const result = await detectGpsLoss(shipmentId, 40.7128, -74.006);
      expect(result.hasGpsLoss).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });
  });

  describe('Missing Coordinates', () => {
    it('should treat 0,0 as invalid coordinates', async () => {
      const result = await detectGpsLoss(shipmentId, 0, 0);
      expect(result.hasGpsLoss).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });

    it('should not detect GPS loss with insufficient history', async () => {
      // Create 1 record without GPS
      await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 50,
        latitude: 0,
        longitude: 0,
        batteryLevel: 80,
        timestamp: new Date(),
        dataHash: 'test-hash',
        rawPayload: {},
      });

      const result = await detectGpsLoss(shipmentId, 0, 0);

      expect(result.hasGpsLoss).toBe(false);
      expect(result.consecutiveCount).toBeLessThan(GPS_LOSS_THRESHOLD);
    });
  });

  describe('Consecutive Missing Readings', () => {
    it('should detect GPS loss after N consecutive missing readings', async () => {
      // Create GPS_LOSS_THRESHOLD records without valid coordinates
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

    it('should break GPS loss streak when valid coordinates received', async () => {
      // Create GPS_LOSS_THRESHOLD - 1 records without GPS
      for (let i = 0; i < GPS_LOSS_THRESHOLD - 1; i++) {
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

      // Add one with valid GPS
      await Telemetry.create({
        shipmentId,
        temperature: 20,
        humidity: 50,
        latitude: 40.7128,
        longitude: -74.006,
        batteryLevel: 80,
        timestamp: new Date(Date.now() - 1000),
        dataHash: 'hash-valid',
        rawPayload: {},
      });

      const result = await detectGpsLoss(shipmentId, 0, 0);

      expect(result.hasGpsLoss).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });
  });

  describe('Mixed Coordinates', () => {
    it('should count consecutive from most recent backwards', async () => {
      // Create mixed pattern: valid, missing, missing, valid, missing
      const records = [
        { lat: 40.7128, lng: -74.006, ts: Date.now() - 4000 }, // valid
        { lat: 0, lng: 0, ts: Date.now() - 3000 }, // missing
        { lat: 0, lng: 0, ts: Date.now() - 2000 }, // missing
        { lat: 39.7392, lng: -104.9903, ts: Date.now() - 1000 }, // valid
      ];

      for (const r of records) {
        await Telemetry.create({
          shipmentId,
          temperature: 20,
          humidity: 50,
          latitude: r.lat,
          longitude: r.lng,
          batteryLevel: 80,
          timestamp: new Date(r.ts),
          dataHash: `hash-${r.ts}`,
          rawPayload: {},
        });
      }

      const result = await detectGpsLoss(shipmentId, 0, 0);

      // Current reading + 2 previous missing readings = 3 total
      expect(result.hasGpsLoss).toBe(true);
      expect(result.consecutiveCount).toBeGreaterThanOrEqual(GPS_LOSS_THRESHOLD);
    });
  });

  describe('Edge Cases', () => {
    it('should handle NaN coordinates gracefully', async () => {
      const result = await detectGpsLoss(shipmentId, NaN, NaN);
      expect(result.hasGpsLoss).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });

    it('should handle null/undefined gracefully', async () => {
      const result = await detectGpsLoss(
        shipmentId,
        null as unknown as number,
        undefined as unknown as number
      );
      expect(result.hasGpsLoss).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });

    it('should handle shipment with no telemetry', async () => {
      const result = await detectGpsLoss(shipmentId, 0, 0);
      expect(result.hasGpsLoss).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });
  });
});
