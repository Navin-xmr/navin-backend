import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Application } from 'express';
import { env } from '../src/env.js';
import { UserRole } from '../src/shared/constants/index.js';
import { DEFAULT_TELEMETRY_THRESHOLDS } from '../src/modules/telemetry/telemetryThreshold.constants.js';

const ORG_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const thresholdStore: Array<{
  organizationId: string;
  shipmentType: string;
  maxTemp?: number | null;
  minTemp?: number | null;
  maxHumidity?: number | null;
  minHumidity?: number | null;
  minBatteryLevel?: number | null;
}> = [];

const shipmentStore: Array<{
  _id: string;
  enterpriseId: string;
  offChainMetadata?: Record<string, unknown>;
}> = [];

await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
  isTokenBlocked: jest.fn(() => Promise.resolve(false)),
  blockToken: jest.fn(),
}));

await jest.unstable_mockModule('../src/modules/telemetry/telemetryThreshold.model.js', () => ({
  TelemetryThreshold: {
    findOne: (query: { organizationId: string; shipmentType: string }) => ({
      lean: () =>
        Promise.resolve(
          thresholdStore.find(
            t =>
              t.organizationId === String(query.organizationId) &&
              t.shipmentType === query.shipmentType
          ) ?? null
        ),
    }),
    findOneAndUpdate: (
      query: { organizationId: string; shipmentType: string },
      update: Record<string, unknown>
    ) => ({
      lean: () => {
        const idx = thresholdStore.findIndex(
          t =>
            t.organizationId === String(query.organizationId) &&
            t.shipmentType === query.shipmentType
        );
        const record = {
          organizationId: String(query.organizationId),
          shipmentType: String(query.shipmentType),
          maxTemp: update.maxTemp as number | null,
          minTemp: update.minTemp as number | null,
          maxHumidity: update.maxHumidity as number | null,
          minHumidity: update.minHumidity as number | null,
          minBatteryLevel: update.minBatteryLevel as number | null,
        };
        if (idx === -1) thresholdStore.push(record);
        else thresholdStore[idx] = record;
        return Promise.resolve(record);
      },
    }),
  },
}));

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    findById: (id: string) => ({
      select: () => ({
        lean: () =>
          Promise.resolve(shipmentStore.find(s => s._id === id) ?? null),
      }),
    }),
  },
  ShipmentStatus: {},
}));

const { buildApp } = await import('../src/app.js');

function tokenFor(role: string) {
  return jwt.sign(
    { userId: 'user-1', role, organizationId: ORG_ID, jti: randomUUID() },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Telemetry thresholds API', () => {
  let app: Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    thresholdStore.length = 0;
    shipmentStore.length = 0;
  });

  it('GET /api/telemetry/thresholds returns defaults without auth', async () => {
    const res = await request(app).get('/api/telemetry/thresholds');
    expect(res.status).toBe(401);
  });

  it('GET /api/telemetry/thresholds returns org defaults for viewer', async () => {
    const res = await request(app)
      .get('/api/telemetry/thresholds')
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.thresholds).toEqual({
      maxTemp: DEFAULT_TELEMETRY_THRESHOLDS.maxTemp,
      minTemp: null,
      maxHumidity: DEFAULT_TELEMETRY_THRESHOLDS.maxHumidity,
      minHumidity: null,
      minBatteryLevel: DEFAULT_TELEMETRY_THRESHOLDS.minBatteryLevel,
    });
  });

  it('PUT /api/telemetry/thresholds forbids viewer role', async () => {
    const res = await request(app)
      .put('/api/telemetry/thresholds')
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`)
      .send({ maxTemp: 30 });
    expect(res.status).toBe(403);
  });

  it('PUT /api/telemetry/thresholds updates values for admin', async () => {
    const res = await request(app)
      .put('/api/telemetry/thresholds')
      .set('Authorization', `Bearer ${tokenFor(UserRole.ADMIN)}`)
      .send({ maxTemp: 30, minBatteryLevel: 15 });
    expect(res.status).toBe(200);
    expect(res.body.data.thresholds.maxTemp).toBe(30);
    expect(res.body.data.thresholds.minBatteryLevel).toBe(15);
  });

  it('PUT /api/telemetry/thresholds validates body', async () => {
    const res = await request(app)
      .put('/api/telemetry/thresholds')
      .set('Authorization', `Bearer ${tokenFor(UserRole.ADMIN)}`)
      .send({ maxTemp: 'hot' });
    expect([400, 422]).toContain(res.status);
  });
});
