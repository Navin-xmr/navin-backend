import { describe, expect, beforeEach, it, jest, afterAll } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Telemetry, TelemetryAnchorStatus } from '../src/modules/telemetry/telemetry.model.js';
import { updateTelemetryAnchor, markTelemetryAnchorFailed } from '../src/modules/telemetry/telemetry.service.js';

describe('Stellar Worker Functions', () => {
  let mongoServer: MongoMemoryServer;

  beforeEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    await Telemetry.deleteMany({});
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('updateTelemetryAnchor', () => {
    it('updates telemetry with stellar tx hash and ANCHORED status', async () => {
      const telemetry = await Telemetry.create({
        shipmentId: '507f1f77bcf86cd799439011',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: new Date(),
        dataHash: 'abc123',
        anchorStatus: TelemetryAnchorStatus.PENDING_ANCHOR,
        rawPayload: {},
      });

      const updated = await updateTelemetryAnchor(
        telemetry._id.toString(),
        'stellar-tx-hash-123'
      );

      expect(updated).toBeDefined();
      expect(updated!.stellarTxHash).toBe('stellar-tx-hash-123');
      expect(updated!.anchorStatus).toBe(TelemetryAnchorStatus.ANCHORED);
    });

    it('returns null when telemetry not found', async () => {
      const updated = await updateTelemetryAnchor(
        '507f1f77bcf86cd799439099',
        'stellar-tx-hash-123'
      );

      expect(updated).toBeNull();
    });
  });

  describe('markTelemetryAnchorFailed', () => {
    it('marks telemetry as ANCHOR_FAILED with error message', async () => {
      const telemetry = await Telemetry.create({
        shipmentId: '507f1f77bcf86cd799439011',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: new Date(),
        dataHash: 'abc123',
        anchorStatus: TelemetryAnchorStatus.PENDING_ANCHOR,
        rawPayload: {},
      });

      const updated = await markTelemetryAnchorFailed(
        telemetry._id.toString(),
        'Network timeout'
      );

      expect(updated).toBeDefined();
      expect(updated!.anchorStatus).toBe(TelemetryAnchorStatus.ANCHOR_FAILED);
      expect(updated!.anchorError).toBe('Network timeout');
    });

    it('returns null when telemetry not found', async () => {
      const updated = await markTelemetryAnchorFailed(
        '507f1f77bcf86cd799439099',
        'Error message'
      );

      expect(updated).toBeNull();
    });
  });

  describe('Telemetry Model', () => {
    it('creates telemetry with PENDING_ANCHOR status by default', async () => {
      const telemetry = await Telemetry.create({
        shipmentId: '507f1f77bcf86cd799439011',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: new Date(),
        dataHash: 'abc123',
        rawPayload: {},
      });

      expect(telemetry.anchorStatus).toBe(TelemetryAnchorStatus.PENDING_ANCHOR);
      expect(telemetry.stellarTxHash).toBeUndefined();
    });

    it('allows creating telemetry with ANCHORED status', async () => {
      const telemetry = await Telemetry.create({
        shipmentId: '507f1f77bcf86cd799439011',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: new Date(),
        dataHash: 'abc123',
        stellarTxHash: 'tx-hash-123',
        anchorStatus: TelemetryAnchorStatus.ANCHORED,
        rawPayload: {},
      });

      expect(telemetry.anchorStatus).toBe(TelemetryAnchorStatus.ANCHORED);
      expect(telemetry.stellarTxHash).toBe('tx-hash-123');
    });

    it('allows creating telemetry with ANCHOR_FAILED status', async () => {
      const telemetry = await Telemetry.create({
        shipmentId: '507f1f77bcf86cd799439011',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: new Date(),
        dataHash: 'abc123',
        anchorStatus: TelemetryAnchorStatus.ANCHOR_FAILED,
        anchorError: 'Network error',
        rawPayload: {},
      });

      expect(telemetry.anchorStatus).toBe(TelemetryAnchorStatus.ANCHOR_FAILED);
      expect(telemetry.anchorError).toBe('Network error');
    });
  });
});
