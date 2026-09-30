import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';
import { DEFAULT_SHIPMENT_TYPE, DEFAULT_TELEMETRY_THRESHOLDS } from '../src/modules/telemetry/telemetryThreshold.constants.js';
import request from 'supertest';
import { signToken } from './fixtures/factories.js';
import type { Application } from 'express';

/** @see docs/telemetry-pipeline.md */
// Relative specifier (not file://) so jest.unstable_mockModule resolves like production imports
const socketIoPath = '../src/infra/socket/io.js';

/**
 * Integration tests for GET /api/telemetry/thresholds.
 * Validates Requirements 2.1, 2.2.
 */
describe('GET /api/telemetry/thresholds', () => {

  const validToken = signToken({ userId: '671000000000000000000001', role: 'ADMIN', organizationId: '671000000000000000000002', jti: 'test-jti-thresholds' }, { expiresIn: '1h' });

  let app: Application;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    await jest.unstable_mockModule(socketIoPath, () => ({
      initSocketIO: jest.fn(),
      getIO: jest.fn(),
      emitAnomalyDetected: jest.fn(),
      emitTelemetryUpdate: jest.fn(),
      emitPaymentStatusChange: jest.fn(),
      emitStatusUpdate: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn(),
      pushStellarAnchorJob: jest.fn(),
      getTransactionQueue: jest.fn(),
      getRedisClient: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: { find: jest.fn() },
      TelemetryAnchorStatus: {
        PENDING_ANCHOR: 'PENDING_ANCHOR',
        ANCHORED: 'ANCHORED',
        ANCHOR_FAILED: 'ANCHOR_FAILED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: { find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn() },
      ShipmentStatus: {
        CREATED: 'CREATED',
        IN_TRANSIT: 'IN_TRANSIT',
        DELIVERED: 'DELIVERED',
        CANCELLED: 'CANCELLED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
      detectAnomaly: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetryThreshold.model.js', () => ({
      TelemetryThreshold: {
        findOne: () => ({
          lean: () => Promise.resolve(null),
        }),
        findOneAndUpdate: () => ({
          lean: () => Promise.resolve(null),
        }),
      },
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('returns 200 with correct thresholds data for authenticated request (Requirement 2.1)', async () => {
    const res = await request(app)
      .get('/api/telemetry/thresholds')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shipmentType).toBe(DEFAULT_SHIPMENT_TYPE);
    expect(res.body.data.thresholds).toEqual({
      maxTemp: DEFAULT_TELEMETRY_THRESHOLDS.maxTemp,
      minTemp: null,
      maxHumidity: DEFAULT_TELEMETRY_THRESHOLDS.maxHumidity,
      minHumidity: null,
      minBatteryLevel: DEFAULT_TELEMETRY_THRESHOLDS.minBatteryLevel,
    });
  });

  it('returns 401 for unauthenticated request (Requirement 2.2)', async () => {
    const res = await request(app)
      .get('/api/telemetry/thresholds');

    expect(res.status).toBe(401);
  });
});
