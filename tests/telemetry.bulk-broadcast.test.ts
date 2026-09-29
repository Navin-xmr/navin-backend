import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';
import request from 'supertest';
import { signToken } from './fixtures/factories.js';
import type { Application } from 'express';
import * as fc from 'fast-check';
import {
  socketIoMock,
  telemetryEmitterMock,
  telemetryPayloadProblems,
  expectTelemetryPayload,
} from './helpers/socketContract.js';
import type { TelemetryUpdatePayload } from '../src/shared/types/socketEvents.js';

/** @see telemetry-improvements spec */
// Relative specifier (not file://) so jest.unstable_mockModule resolves like production imports
const socketIoPath = '../src/infra/socket/io.js';

// ─────────────────────────────────────────────────────────────────────────────
// Task 6: Socket.io broadcast tests for POST /api/telemetry/bulk
// ─────────────────────────────────────────────────────────────────────────────

type SyntheticTelemetryDoc = {
  _id: { toString: () => string };
  shipmentId: { toString: () => string };
  sensorId: string | undefined;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: Date;
  dataHash: string;
  anchorStatus: 'PENDING_ANCHOR';
  stellarTxHash: string | undefined;
};

type TelemetryCreateInput = {
  shipmentId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: Date;
  sensorId?: string;
};

// ─── Shared synthetic Telemetry.create factory ───────────────────────────────
// Returns a document whose timestamp is a real Date (service calls .toISOString())
function makeSyntheticTelemetryDoc(doc: TelemetryCreateInput, id: string): SyntheticTelemetryDoc {
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
  const validToken = signToken(
    {
      userId: '671000000000000000000001',
      role: 'ADMIN',
      organizationId: '671000000000000000000002',
      jti: 'test-jti-bulk-broadcast',
    },
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
  const mockEmitTelemetryUpdate = telemetryEmitterMock();
  const mockTelemetryCreate =
    jest.fn<(doc: TelemetryCreateInput) => Promise<SyntheticTelemetryDoc>>();

  let app: Application;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    let createCallCount = 0;
    mockTelemetryCreate.mockImplementation(doc =>
      Promise.resolve(makeSyntheticTelemetryDoc(doc, `telemetry-id-${++createCallCount}`))
    );

    // #759: the mock must expose the *whole* io.js surface. The payments module
    // imports `emitPaymentStatusChange`, so omitting it broke module linking
    // ("does not provide an export named 'emitPaymentStatusChange'").
    await jest.unstable_mockModule(socketIoPath, () =>
      socketIoMock({
        emitTelemetryUpdate: mockEmitTelemetryUpdate,
      })
    );

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn(),
      pushStellarAnchorJob: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
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
      detectAnomaly: jest
        .fn<() => Promise<{ detected: boolean; anomalies: unknown[] }>>()
        .mockResolvedValue({ detected: false, anomalies: [] }),
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

  it('broadcasts to the item shipmentId (Req 4.2)', async () => {
    const res = await request(app)
      .post('/api/telemetry/bulk')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ items: [singleItem] });

    expect(res.status).toBe(201);
    const [shipmentId] = mockEmitTelemetryUpdate.mock.calls[0];
    expect(shipmentId).toBe(singleItem.shipmentId);
  });

  it('broadcast payload satisfies the full TelemetryUpdatePayload contract (Req 4.3)', async () => {
    const res = await request(app)
      .post('/api/telemetry/bulk')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ items: [singleItem] });

    expect(res.status).toBe(201);

    const payload: TelemetryUpdatePayload = expectTelemetryPayload(
      mockEmitTelemetryUpdate.mock.calls[0][1]
    );

    expect(payload.shipmentId).toBe(singleItem.shipmentId);
    expect(payload.temperature).toBe(singleItem.temperature);
    expect(payload.humidity).toBe(singleItem.humidity);
    expect(payload.latitude).toBe(singleItem.latitude);
    expect(payload.longitude).toBe(singleItem.longitude);
    expect(payload.batteryLevel).toBe(singleItem.batteryLevel);
    expect(payload.timestamp).toBe(new Date(singleItem.timestamp).toISOString());
    expect(payload.telemetryId).toBe('telemetry-id-1');
    // sensorId falls back to the shipmentId when the item carries none.
    expect(payload.sensorId).toBe(singleItem.shipmentId);
    expect(payload.anchorStatus).toBe('PENDING_ANCHOR');
    // Not anchored yet, so the optional Stellar hash must stay absent.
    expect(payload.stellarTxHash).toBeUndefined();
  });

  it('returns 401 and does not broadcast when JWT is absent (Req 4.5)', async () => {
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
  it('emitTelemetryUpdate is called exactly N times for N items (Req 4.4)', async () => {
    // Feature: telemetry-improvements, Property 1: Bulk ingest emit count equals item count
    jest.resetModules();

    const mockEmit = telemetryEmitterMock();
    let createCallCount = 0;

    await jest.unstable_mockModule(socketIoPath, () =>
      socketIoMock({ emitTelemetryUpdate: mockEmit })
    );

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn(),
      pushStellarAnchorJob: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getTransactionQueue: jest.fn(),
      getRedisClient: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
      detectAnomaly: jest
        .fn<() => Promise<{ detected: boolean; anomalies: unknown[] }>>()
        .mockResolvedValue({ detected: false, anomalies: [] }),
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: {
        create: jest
          .fn<(doc: TelemetryCreateInput) => Promise<SyntheticTelemetryDoc>>()
          .mockImplementation(doc =>
            Promise.resolve(makeSyntheticTelemetryDoc(doc, `telemetry-id-${++createCallCount}`))
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

    const { bulkIngestTelemetry } = await import('../src/modules/telemetry/telemetry.service.js');

    const itemArb = fc.record({
      shipmentId: fc.hexaString({ minLength: 24, maxLength: 24 }),
      temperature: fc.float({ min: -50, max: 100, noNaN: true }),
      humidity: fc.float({ min: 0, max: 100, noNaN: true }),
      latitude: fc.float({ min: -90, max: 90, noNaN: true }),
      longitude: fc.float({ min: -180, max: 180, noNaN: true }),
      batteryLevel: fc.float({ min: 0, max: 100, noNaN: true }),
      timestamp: fc
        .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
        .filter(d => !Number.isNaN(d.getTime())),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(itemArb, { minLength: 1, maxLength: 10 }), async items => {
        mockEmit.mockClear();
        createCallCount = 0;

        await bulkIngestTelemetry(items);

        return mockEmit.mock.calls.length === items.length;
      }),
      { numRuns: 100 }
    );
  }, 60_000);
});

/**
 * 6.3 Property-based test: emit payload shape invariant.
 * // Feature: telemetry-improvements, Property 2: Emit payload contains all required TelemetryUpdatePayload fields
 * Validates: Requirements 4.3
 */
describe('bulkIngestTelemetry — Property 2: emit payload contains all required TelemetryUpdatePayload fields', () => {
  it('second argument to emitTelemetryUpdate always contains all required TelemetryUpdatePayload fields (Req 4.3)', async () => {
    // Feature: telemetry-improvements, Property 2: Emit payload contains all required TelemetryUpdatePayload fields
    jest.resetModules();

    const mockEmit = telemetryEmitterMock();
    let createCallCount = 0;

    await jest.unstable_mockModule(socketIoPath, () =>
      socketIoMock({ emitTelemetryUpdate: mockEmit })
    );

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn(),
      pushStellarAnchorJob: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getTransactionQueue: jest.fn(),
      getRedisClient: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
      detectAnomaly: jest
        .fn<() => Promise<{ detected: boolean; anomalies: unknown[] }>>()
        .mockResolvedValue({ detected: false, anomalies: [] }),
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: {
        create: jest
          .fn<(doc: TelemetryCreateInput) => Promise<SyntheticTelemetryDoc>>()
          .mockImplementation(doc =>
            Promise.resolve(makeSyntheticTelemetryDoc(doc, `telemetry-id-${++createCallCount}`))
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

    const { bulkIngestTelemetry } = await import('../src/modules/telemetry/telemetry.service.js');

    const itemArb = fc.record({
      shipmentId: fc.hexaString({ minLength: 24, maxLength: 24 }),
      temperature: fc.float({ min: -50, max: 100, noNaN: true }),
      humidity: fc.float({ min: 0, max: 100, noNaN: true }),
      latitude: fc.float({ min: -90, max: 90, noNaN: true }),
      longitude: fc.float({ min: -180, max: 180, noNaN: true }),
      batteryLevel: fc.float({ min: 0, max: 100, noNaN: true }),
      timestamp: fc
        .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
        .filter(d => !Number.isNaN(d.getTime())),
    });

    await fc.assert(
      fc.asyncProperty(itemArb, async item => {
        mockEmit.mockClear();
        createCallCount = 0;

        await bulkIngestTelemetry([item]);

        if (mockEmit.mock.calls.length !== 1) return false;

        return telemetryPayloadProblems(mockEmit.mock.calls[0][1]).length === 0;
      }),
      { numRuns: 100 }
    );
  }, 60_000);
});
