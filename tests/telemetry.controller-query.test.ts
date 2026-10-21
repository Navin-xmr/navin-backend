import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';
import request from 'supertest';
import { signToken } from './fixtures/factories.js';
import type { Application } from 'express';

/** @see docs/telemetry-pipeline.md */
// Relative specifier (not file://) so jest.unstable_mockModule resolves like production imports
const socketIoPath = '../src/infra/socket/io.js';

/**
 * Regression tests for controller bug fixes in getTelemetry.
 * Validates Requirements 3.1, 3.2.
 */
describe('getTelemetry controller bug fixes', () => {

  // Generate a valid JWT for auth
  const validToken = signToken({ userId: '671000000000000000000001', role: 'ADMIN', organizationId: '671000000000000000000002', jti: 'test-jti-regression' }, { expiresIn: '1h' });

  describe('page parameter â€” no ReferenceError (Requirement 3.1)', () => {
    let app: Application;

    const mockTelemetryFind = jest.fn<() => { select: () => { sort: () => { limit: () => { lean: () => Promise<[]> } } } }>();
    const mockShipmentFind = jest.fn<() => { select: () => { lean: () => Promise<[]> } }>();

    beforeEach(async () => {
      jest.clearAllMocks();
      jest.resetModules();

      // Stub Telemetry.find to return an empty result (avoids DB)
      mockTelemetryFind.mockReturnValue({
        select: () => ({
          sort: () => ({
            limit: () => ({
              lean: async () => [],
            }),
          }),
        }),
      } as ReturnType<typeof mockTelemetryFind>);

      // Stub Shipment.find for organizationId lookup
      mockShipmentFind.mockReturnValue({
        select: () => ({
          lean: async () => [],
        }),
      } as ReturnType<typeof mockShipmentFind>);

      await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
        Telemetry: {
          find: mockTelemetryFind,
        },
        TelemetryAnchorStatus: {
          PENDING_ANCHOR: 'PENDING_ANCHOR',
          ANCHORED: 'ANCHORED',
          ANCHOR_FAILED: 'ANCHOR_FAILED',
        },
      }));

      await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
        Shipment: {
          find: mockShipmentFind,
          findById: jest.fn(),
          findByIdAndUpdate: jest.fn(),
        },
        ShipmentStatus: {
          CREATED: 'CREATED',
          IN_TRANSIT: 'IN_TRANSIT',
          DELIVERED: 'DELIVERED',
          CANCELLED: 'CANCELLED',
        },
      }));

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

      await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
        detectAnomaly: jest.fn(),
      }));

      const appModule = await import('../src/app.js');
      app = appModule.buildApp();
    });

    it('GET /api/telemetry?page=1 returns 200 (not 500 ReferenceError)', async () => {
      const res = await request(app)
        .get('/api/telemetry?page=1')
        .set('Authorization', `Bearer ${validToken}`);

      // Before the fix this threw ReferenceError: pageNumber is not defined â†’ 500
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('from/to forwarding to service (Requirement 3.2)', () => {
    let app: Application;
    let capturedFindQuery: Record<string, unknown> | undefined;

    // Do NOT mock telemetry.service — a sticky unstable_mockModule stub for
    // bulkIngestTelemetry would prevent later suites from exercising the real
    // emitTelemetryUpdate path (Issue #255).
    const mockTelemetryFind = jest.fn((query: Record<string, unknown>) => {
      capturedFindQuery = query;
      // Mongoose Query is mutable/chainable: limit() then lean() on the same object
      const chain: {
        select: () => typeof chain;
        sort: () => typeof chain;
        skip: () => typeof chain;
        limit: () => typeof chain;
        lean: () => Promise<unknown[]>;
      } = {
        select: () => chain,
        sort: () => chain,
        skip: () => chain,
        limit: () => chain,
        lean: async () => [],
      };
      return chain;
    });

    const mockShipmentFind = jest.fn(() => ({
      select: () => ({
        lean: async () => [{ _id: 'aabbccddeeff001122334455' }],
      }),
    }));

    beforeEach(async () => {
      jest.clearAllMocks();
      jest.resetModules();
      capturedFindQuery = undefined;

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
        Telemetry: { find: mockTelemetryFind },
        TelemetryAnchorStatus: {
          PENDING_ANCHOR: 'PENDING_ANCHOR',
          ANCHORED: 'ANCHORED',
          ANCHOR_FAILED: 'ANCHOR_FAILED',
        },
      }));

      await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
        Shipment: {
          find: mockShipmentFind,
          findById: jest.fn(),
          findByIdAndUpdate: jest.fn(),
        },
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

      const appModule = await import('../src/app.js');
      app = appModule.buildApp();
    });

    it('GET /api/telemetry?from=...&to=... forwards Date objects into the telemetry query', async () => {
      const fromStr = '2026-01-01T00:00:00.000Z';
      const toStr = '2026-12-31T23:59:59.000Z';

      const res = await request(app)
        .get(`/api/telemetry?from=${fromStr}&to=${toStr}`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(mockTelemetryFind).toHaveBeenCalledTimes(1);
      expect(capturedFindQuery).toBeDefined();

      const timestamp = capturedFindQuery?.['timestamp'] as { $gte?: Date; $lte?: Date };
      // Zod coerces the string to a Date before the controller/service runs
      expect(timestamp.$gte).toBeInstanceOf(Date);
      expect(timestamp.$lte).toBeInstanceOf(Date);
      expect(timestamp.$gte!.toISOString()).toBe(fromStr);
      expect(timestamp.$lte!.toISOString()).toBe(toStr);
    });
  });
});
