/**
 * Public tracking route coverage (#716 / #717).
 * Covers 200 / 404 / 400 / 429, 401-never, rate-limit headers, and safe-subset leakage.
 */
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import request from 'supertest';
import { Types } from 'mongoose';
import type { Application } from 'express';
import { buildApp } from '../src/app.js';
import { Shipment, ShipmentStatus } from '../src/modules/shipments/shipments.model.js';
import { createMockShipment } from './fixtures/factories.js';

const INTERNAL_LEAK_KEYS = [
  'enterpriseId',
  'logisticsId',
  'offChainMetadata',
  'stellarTokenId',
  'cost',
  'costs',
  'parties',
  'passwordHash',
  'documents',
  'photos',
  'disputes',
  '_id',
  '__v',
] as const;

describe('GET /api/public/tracking/:trackingNumber', () => {
  let app: Application;

  beforeAll(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await Shipment.deleteMany({ trackingNumber: { $regex: /^PUB-/ } });
  });

  it('returns 200 with the public safe subset for a known tracking number', async () => {
    const enterpriseId = new Types.ObjectId();
    const logisticsId = new Types.ObjectId();
    const mock = createMockShipment({
      trackingNumber: 'PUB-200OK01',
      origin: 'Lagos',
      destination: 'Accra',
      enterpriseId: enterpriseId.toString(),
      logisticsId: logisticsId.toString(),
      status: ShipmentStatus.IN_TRANSIT,
      milestones: [
        { name: 'CREATED', timestamp: new Date('2026-01-01T00:00:00Z') },
        { name: 'IN_TRANSIT', timestamp: new Date('2026-01-02T00:00:00Z') },
      ],
      offChainMetadata: { secretRoute: 'do-not-leak', cost: 9999 },
    });

    await Shipment.create({
      trackingNumber: mock.trackingNumber,
      origin: mock.origin,
      destination: mock.destination,
      enterpriseId,
      logisticsId,
      status: mock.status,
      expectedDelivery: mock.expectedDelivery,
      milestones: mock.milestones,
      offChainMetadata: mock.offChainMetadata,
      stellarTokenId: 'secret-token-id',
    });

    const res = await request(app).get(`/api/public/tracking/${mock.trackingNumber}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Shipment tracking retrieved',
      data: {
        trackingNumber: 'PUB-200OK01',
        status: ShipmentStatus.IN_TRANSIT,
        originCity: 'Lagos',
        destinationCity: 'Accra',
      },
    });
    expect(Array.isArray(res.body.data.milestones)).toBe(true);

    for (const key of INTERNAL_LEAK_KEYS) {
      expect(res.body.data).not.toHaveProperty(key);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/secretRoute|secret-token-id|9999/);
  });

  it('returns 404 for an unknown tracking number', async () => {
    const res = await request(app).get('/api/public/tracking/PUB-UNKNOWN');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
  });

  it('returns 400 for an invalid tracking number parameter', async () => {
    const res = await request(app).get('/api/public/tracking/%20%20');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('never requires auth (no 401 without a bearer token)', async () => {
    const res = await request(app).get('/api/public/tracking/PUB-NOAUTH1');

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(404);
  });

  it('applies the strict rate limiter and returns 429 when abused', async () => {
    // Isolated app instance so prior suite requests do not share the counter.
    const limitedApp = buildApp();
    let limited: { status: number; body: Record<string, unknown>; headers: Record<string, unknown> } | null =
      null;

    for (let i = 0; i < 15; i += 1) {
      const res = await request(limitedApp).get('/api/public/tracking/PUB-RATE001');
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);
    expect(limited!.body).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringMatching(/too many/i),
        data: null,
        retryAfter: expect.any(Number),
      })
    );
    expect(limited!.headers['retry-after']).toBeDefined();
    expect(limited!.headers['ratelimit-limit']).toBeDefined();
  });
});
