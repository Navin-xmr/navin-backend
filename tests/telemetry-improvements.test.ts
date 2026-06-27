import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';

/**
 * Schema-inspection tests for TelemetrySchema indexes.
 * Validates Requirements 1.1, 1.2, 1.3, 1.4.
 */
describe('TelemetrySchema index definitions', () => {
  it('retains the existing { shipmentId: 1, timestamp: -1 } index (Requirement 1.2)', () => {
    const indexes = Telemetry.schema.indexes();
    const fieldSpecs = indexes.map(([fields]) => fields);

    expect(fieldSpecs).toEqual(
      expect.arrayContaining([{ shipmentId: 1, timestamp: -1 }])
    );
  });

  it('defines the new { sensorId: 1, shipmentId: 1, timestamp: -1 } composite index (Requirement 1.1)', () => {
    const indexes = Telemetry.schema.indexes();
    const fieldSpecs = indexes.map(([fields]) => fields);

    expect(fieldSpecs).toEqual(
      expect.arrayContaining([{ sensorId: 1, shipmentId: 1, timestamp: -1 }]),
    );
  });
});

import { getTelemetryThresholds } from '../src/modules/telemetry/telemetry.service.js';

/**
 * Unit tests for getTelemetryThresholds service function.
 * Validates Requirement 2.3.
 */
describe('getTelemetryThresholds', () => {
  it('returns the hardcoded threshold object { maxTemp: 85, maxHumidity: 90, minBatteryLevel: 20 }', () => {
    const result = getTelemetryThresholds();
    expect(result).toEqual({ maxTemp: 85, maxHumidity: 90, minBatteryLevel: 20 });
  });
});

import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

/**
 * Regression tests for controller bug fixes in getTelemetry.
 * Validates Requirements 3.1, 3.2.
 */
describe('getTelemetry controller bug fixes', () => {
  const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-key-at-least-32-chars-long!';

  // Generate a valid JWT for auth
  const validToken = jwt.sign(
    { userId: '671000000000000000000001', role: 'ADMIN', organizationId: '671000000000000000000002', jti: 'test-jti-regression' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

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

      await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
        initSocketIO: jest.fn(),
        getIO: jest.fn(),
        emitAnomalyDetected: jest.fn(),
        emitTelemetryUpdate: jest.fn(),
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

    const mockGetTelemetryService = jest.fn<(params: Record<string, unknown>) => Promise<{ data: []; nextCursor: null; hasMore: false }>>();

    beforeEach(async () => {
      jest.clearAllMocks();
      jest.resetModules();

      mockGetTelemetryService.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });

      await jest.unstable_mockModule('../src/modules/telemetry/telemetry.service.js', () => ({
        getTelemetryService: mockGetTelemetryService,
        bulkIngestTelemetry: jest.fn(),
        getTelemetryThresholds: jest.fn(() => ({ maxTemp: 85, maxHumidity: 90, minBatteryLevel: 20 })),
        findActiveShipmentBySensorId: jest.fn(),
        createTelemetryRecord: jest.fn(),
        updateTelemetryAnchor: jest.fn(),
        markTelemetryAnchorFailed: jest.fn(),
      }));

      await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
        initSocketIO: jest.fn(),
        getIO: jest.fn(),
        emitAnomalyDetected: jest.fn(),
        emitTelemetryUpdate: jest.fn(),
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

      const appModule = await import('../src/app.js');
      app = appModule.buildApp();
    });

    it('GET /api/telemetry?from=...&to=... calls getTelemetryService with Date objects', async () => {
      const fromStr = '2026-01-01T00:00:00.000Z';
      const toStr = '2026-12-31T23:59:59.000Z';

      const res = await request(app)
        .get(`/api/telemetry?from=${fromStr}&to=${toStr}`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(mockGetTelemetryService).toHaveBeenCalledTimes(1);

      const callArgs = mockGetTelemetryService.mock.calls[0][0] as unknown as {
        from?: Date;
        to?: Date;
      };

      // Zod coerces the string to a Date before the controller runs
      expect(callArgs.from).toBeInstanceOf(Date);
      expect(callArgs.to).toBeInstanceOf(Date);
      expect((callArgs.from as Date).toISOString()).toBe(fromStr);
      expect((callArgs.to as Date).toISOString()).toBe(toStr);
    });
  });
});

/**
 * Integration tests for GET /api/telemetry/thresholds.
 * Validates Requirements 2.1, 2.2.
 */
describe('GET /api/telemetry/thresholds', () => {
  const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-key-at-least-32-chars-long!';

  const validToken = jwt.sign(
    { userId: '671000000000000000000001', role: 'ADMIN', organizationId: '671000000000000000000002', jti: 'test-jti-thresholds' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  let app: Application;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      initSocketIO: jest.fn(),
      getIO: jest.fn(),
      emitAnomalyDetected: jest.fn(),
      emitTelemetryUpdate: jest.fn(),
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

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('returns 200 with correct thresholds data for authenticated request (Requirement 2.1)', async () => {
    const res = await request(app)
      .get('/api/telemetry/thresholds')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ maxTemp: 85, maxHumidity: 90, minBatteryLevel: 20 });
  });

  it('returns 401 for unauthenticated request (Requirement 2.2)', async () => {
    const res = await request(app)
      .get('/api/telemetry/thresholds');

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6: Socket.io broadcast tests for POST /api/telemetry/bulk
// ─────────────────────────────────────────────────────────────────────────────

import * as fc from 'fast-check';

// ─── Shared synthetic Telemetry.create factory ───────────────────────────────
// Returns a document whose timestamp is a real Date (service calls .toISOString())
function makeSyntheticTelemetryDoc(
  doc: {
    shipmentId: string;
    temperature: number;
    humidity: number;
    latitude: number;
    longitude: number;
    batteryLevel: number;
    timestamp: Date;
    sensorId?: string;
  },
  id: string
) {
  return {
    _id: { toString: () => id },
    shipmentId: { toString: () => doc.shipmentId },
    sensorId: doc.sensorId,
    temperature: doc.temperature,
    humidity: doc.humidity,
    latitude: doc.latitude,
    longitude: doc.longitude,
    batteryLevel: doc.batteryLevel,
    timestamp: doc.timestamp instanceof Date ? doc.timestamp : new Date(doc.timestamp),
    dataHash: 'mock-hash',
    anchorStatus: 'PENDING_ANCHOR' as const,
    stellarTxHash: undefined,
  };
}

/**
 * 6.1 Example-based broadcast tests for POST /api/telemetry/bulk.
 * Validates Requirements 4.1, 4.2, 4.3, 4.5.
 *
 * Follows the exact pattern from tests/realtime.events.test.ts:
 * - Mock functions declared at describe scope (stable references for factory closures)
 * - jest.clearAllMocks() only in beforeEach (no resetModules)
 * - jest.unstable_mockModule called in beforeEach before buildApp()
 */
describe('POST /api/telemetry/bulk — Socket.io broadcast (example-based)', () => {
  const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-key-at-least-32-chars-long!';

  const validToken = jwt.sign(
    {
      userId: '671000000000000000000001',
      role: 'ADMIN',
      organizationId: '671000000000000000000002',
      jti: 'test-jti-bulk-broadcast',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const singleItem = {
    shipmentId: 'aabbccddeeff001122334455',
    temperature: 22.5,
    humidity: 55.0,
    latitude: 12.34,
    longitude: 56.78,
    batteryLevel: 91.0,
    timestamp: '2026-01-15T12:30:00.000Z',
  };

  // Stable mock references — factory closures always capture the same objects
  const mockEmitTelemetryUpdate = jest.fn();
  const mockTelemetryCreate = jest.fn<() => Promise<ReturnType<typeof makeSyntheticTelemetryDoc>>>();

  let app: Application;

  beforeEach(async () => {
    jest.clearAllMocks();

    let createCallCount = 0;
    mockTelemetryCreate.mockImplementation(
      (doc: {
        shipmentId: string;
        temperature: number;
        humidity: number;
        latitude: number;
        longitude: number;
        batteryLevel: number;
        timestamp: Date;
        sensorId?: string;
      }) =>
        Promise.resolve(
          makeSyntheticTelemetryDoc(doc, `telemetry-id-${++createCallCount}`)
        )
    );

    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      initSocketIO: jest.fn(),
      getIO: jest.fn(),
      emitAnomalyDetected: jest.fn(),
      emitTelemetryUpdate: mockEmitTelemetryUpdate,
      emitStatusUpdate: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn(),
      pushStellarAnchorJob: jest.fn().mockResolvedValue(undefined),
      getTransactionQueue: jest.fn(),
      getRedisClient: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: { create: mockTelemetryCreate },
      TelemetryAnchorStatus: {
        PENDING_ANCHOR: 'PENDING_ANCHOR',
        ANCHORED: 'ANCHORED',
        ANCHOR_FAILED: 'ANCHOR_FAILED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        find: jest.fn(),
        findOne: jest.fn(),
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
      detectAnomaly: jest.fn().mockResolvedValue({ detected: false, anomalies: [] }),
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('emitTelemetryUpdate is called exactly once for a single-item bulk ingest (Req 4.1)', async () => {
    const res = await request(app)
      .post('/api/telemetry/bulk')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ items: [singleItem] });

    expect(res.status).toBe(201);
    expect(mockEmitTelemetryUpdate).toHaveBeenCalledTimes(1);
  });

  it('first argument to emitTelemetryUpdate equals the item shipmentId (Req 4.2)', async () => {
    const res = await request(app)
      .post('/api/telemetry/bulk')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ items: [singleItem] });

    expect(res.status).toBe(201);
    const firstArg = mockEmitTelemetryUpdate.mock.calls[0][0] as string;
    expect(firstArg).toBe(singleItem.shipmentId);
  });

  it('second argument to emitTelemetryUpdate contains all required TelemetryUpdatePayload fields (Req 4.3)', async () => {
    const res = await request(app)
      .post('/api/telemetry/bulk')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ items: [singleItem] });

    expect(res.status).toBe(201);
    const payload = mockEmitTelemetryUpdate.mock.calls[0][1] as Record<string, unknown>;

    expect(payload).toEqual(
      expect.objectContaining({
        shipmentId: expect.any(String) as unknown,
        temperature: expect.any(Number) as unknown,
        humidity: expect.any(Number) as unknown,
        latitude: expect.any(Number) as unknown,
        longitude: expect.any(Number) as unknown,
        batteryLevel: expect.any(Number) as unknown,
        timestamp: expect.any(String) as unknown,
        dataHash: expect.any(String) as unknown,
      })
    );
  });

  it('returns 401 and does not call emitTelemetryUpdate when JWT is absent (Req 4.5)', async () => {
    const res = await request(app)
      .post('/api/telemetry/bulk')
      .send({ items: [singleItem] });

    expect(res.status).toBe(401);
    expect(mockEmitTelemetryUpdate).not.toHaveBeenCalled();
  });
});

/**
 * 6.2 Property-based test: emit count equals item count.
 * // Feature: telemetry-improvements, Property 1: Bulk ingest emit count equals item count
 * Validates: Requirements 4.4
 */
describe('bulkIngestTelemetry — Property 1: emit count equals item count', () => {
  it(
    'emitTelemetryUpdate is called exactly N times for N items (Req 4.4)',
    async () => {
      // Feature: telemetry-improvements, Property 1: Bulk ingest emit count equals item count
      jest.resetModules();

      const mockEmit = jest.fn();
      let createCallCount = 0;

      await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
        initSocketIO: jest.fn(),
        getIO: jest.fn(),
        emitAnomalyDetected: jest.fn(),
        emitTelemetryUpdate: mockEmit,
        emitStatusUpdate: jest.fn(),
      }));

      await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
        pushAlertJob: jest.fn(),
        pushStellarAnchorJob: jest.fn().mockResolvedValue(undefined),
        getTransactionQueue: jest.fn(),
        getRedisClient: jest.fn(),
      }));

      await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
        detectAnomaly: jest.fn().mockResolvedValue({ detected: false, anomalies: [] }),
      }));

      await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
        Telemetry: {
          create: jest.fn().mockImplementation(
            (doc: {
              shipmentId: string;
              temperature: number;
              humidity: number;
              latitude: number;
              longitude: number;
              batteryLevel: number;
              timestamp: Date;
              sensorId?: string;
            }) =>
              Promise.resolve(
                makeSyntheticTelemetryDoc(doc, `telemetry-id-${++createCallCount}`)
              )
          ),
        },
        TelemetryAnchorStatus: {
          PENDING_ANCHOR: 'PENDING_ANCHOR',
          ANCHORED: 'ANCHORED',
          ANCHOR_FAILED: 'ANCHOR_FAILED',
        },
      }));

      await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
        Shipment: {
          find: jest.fn(),
          findOne: jest.fn(),
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

      const { bulkIngestTelemetry } = await import(
        '../src/modules/telemetry/telemetry.service.js'
      );

      const itemArb = fc.record({
        shipmentId: fc.hexaString({ minLength: 24, maxLength: 24 }),
        temperature: fc.float({ min: -50, max: 100, noNaN: true }),
        humidity: fc.float({ min: 0, max: 100, noNaN: true }),
        latitude: fc.float({ min: -90, max: 90, noNaN: true }),
        longitude: fc.float({ min: -180, max: 180, noNaN: true }),
        batteryLevel: fc.float({ min: 0, max: 100, noNaN: true }),
        timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(itemArb, { minLength: 1, maxLength: 10 }),
          async items => {
            mockEmit.mockClear();
            createCallCount = 0;

            await bulkIngestTelemetry(items);

            return mockEmit.mock.calls.length === items.length;
          }
        ),
        { numRuns: 100 }
      );
    },
    60_000
  );
});

/**
 * 6.3 Property-based test: emit payload shape invariant.
 * // Feature: telemetry-improvements, Property 2: Emit payload contains all required TelemetryUpdatePayload fields
 * Validates: Requirements 4.3
 */
describe('bulkIngestTelemetry — Property 2: emit payload contains all required TelemetryUpdatePayload fields', () => {
  it(
    'second argument to emitTelemetryUpdate always contains all required TelemetryUpdatePayload fields (Req 4.3)',
    async () => {
      // Feature: telemetry-improvements, Property 2: Emit payload contains all required TelemetryUpdatePayload fields
      jest.resetModules();

      const mockEmit = jest.fn();
      let createCallCount = 0;

      await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
        initSocketIO: jest.fn(),
        getIO: jest.fn(),
        emitAnomalyDetected: jest.fn(),
        emitTelemetryUpdate: mockEmit,
        emitStatusUpdate: jest.fn(),
      }));

      await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
        pushAlertJob: jest.fn(),
        pushStellarAnchorJob: jest.fn().mockResolvedValue(undefined),
        getTransactionQueue: jest.fn(),
        getRedisClient: jest.fn(),
      }));

      await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
        detectAnomaly: jest.fn().mockResolvedValue({ detected: false, anomalies: [] }),
      }));

      await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
        Telemetry: {
          create: jest.fn().mockImplementation(
            (doc: {
              shipmentId: string;
              temperature: number;
              humidity: number;
              latitude: number;
              longitude: number;
              batteryLevel: number;
              timestamp: Date;
              sensorId?: string;
            }) =>
              Promise.resolve(
                makeSyntheticTelemetryDoc(doc, `telemetry-id-${++createCallCount}`)
              )
          ),
        },
        TelemetryAnchorStatus: {
          PENDING_ANCHOR: 'PENDING_ANCHOR',
          ANCHORED: 'ANCHORED',
          ANCHOR_FAILED: 'ANCHOR_FAILED',
        },
      }));

      await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
        Shipment: {
          find: jest.fn(),
          findOne: jest.fn(),
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

      const { bulkIngestTelemetry } = await import(
        '../src/modules/telemetry/telemetry.service.js'
      );

      const itemArb = fc.record({
        shipmentId: fc.hexaString({ minLength: 24, maxLength: 24 }),
        temperature: fc.float({ min: -50, max: 100, noNaN: true }),
        humidity: fc.float({ min: 0, max: 100, noNaN: true }),
        latitude: fc.float({ min: -90, max: 90, noNaN: true }),
        longitude: fc.float({ min: -180, max: 180, noNaN: true }),
        batteryLevel: fc.float({ min: 0, max: 100, noNaN: true }),
        timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
      });

      await fc.assert(
        fc.asyncProperty(itemArb, async item => {
          mockEmit.mockClear();
          createCallCount = 0;

          await bulkIngestTelemetry([item]);

          if (mockEmit.mock.calls.length !== 1) return false;

          const payload = mockEmit.mock.calls[0][1] as Record<string, unknown>;

          return (
            typeof payload['shipmentId'] === 'string' &&
            payload['shipmentId'].length > 0 &&
            typeof payload['temperature'] === 'number' &&
            typeof payload['humidity'] === 'number' &&
            typeof payload['latitude'] === 'number' &&
            typeof payload['longitude'] === 'number' &&
            typeof payload['batteryLevel'] === 'number' &&
            typeof payload['timestamp'] === 'string' &&
            payload['timestamp'].length > 0 &&
            typeof payload['dataHash'] === 'string' &&
            payload['dataHash'].length > 0
          );
        }),
        { numRuns: 100 }
      );
    },
    60_000
  );
});
