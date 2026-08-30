import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Application } from 'express';
import { env } from '../src/env.js';
import { UserRole } from '../src/shared/constants/index.js';

type ShipmentRecord = {
  _id: string;
  trackingNumber: string;
  origin: string;
  destination: string;
  enterpriseId: string;
  logisticsId: string;
  status: string;
  milestones: Record<string, unknown>[];
} & Record<string, unknown>;

const shipmentsData: ShipmentRecord[] = [];
const ORG_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ORG_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const SHIPMENT_ID = 'cccccccccccccccccccccccc';

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
  const ShipmentStatus = {
    CREATED: 'CREATED',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  };

  const Shipment = {
    findById: (id: string) => ({
      lean: () => {
        const found = shipmentsData.find(d => String(d._id) === String(id));
        return Promise.resolve(found ? { ...found } : null);
      },
      select: () => ({
        lean: () => {
          const found = shipmentsData.find(d => String(d._id) === String(id));
          return Promise.resolve(
            found
              ? {
                  enterpriseId: found.enterpriseId,
                  logisticsId: found.logisticsId,
                }
              : null
          );
        },
      }),
    }),
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
    countDocuments: () => Promise.resolve(0),
  };

  return { Shipment, ShipmentStatus };
});

await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
  isTokenBlocked: jest.fn(() => Promise.resolve(false)),
  blockToken: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
  tokenizeShipment: jest.fn(),
  releaseEscrow: jest.fn(),
  getStellarExplorerUrl: jest.fn(() => 'https://stellar.expert/explorer/testnet/tx/mock'),
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  emitStatusUpdate: jest.fn(),
  emitAnomalyDetected: jest.fn(),
  emitTelemetryUpdate: jest.fn(),
      emitPaymentStatusChange: jest.fn(),
  initSocketIO: jest.fn(),
  getIO: jest.fn(),
}));

const { buildApp } = await import('../src/app.js');

function tokenFor(role: string, organizationId: string) {
  return jwt.sign(
    { userId: 'user-1', role, organizationId, jti: randomUUID() },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('GET /api/shipments/:id', () => {
  let app: Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    shipmentsData.length = 0;
    shipmentsData.push({
      _id: SHIPMENT_ID,
      trackingNumber: 'NVN-123456',
      origin: 'NYC',
      destination: 'LA',
      enterpriseId: ORG_A,
      logisticsId: ORG_B,
      status: 'CREATED',
      milestones: [],
    });
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).get(`/api/shipments/${SHIPMENT_ID}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for CUSTOMER role', async () => {
    const res = await request(app)
      .get(`/api/shipments/${SHIPMENT_ID}`)
      .set('Authorization', `Bearer ${tokenFor(UserRole.CUSTOMER, ORG_A)}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 when shipment does not exist', async () => {
    const res = await request(app)
      .get('/api/shipments/ffffffffffffffffffffffff')
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER, ORG_A)}`);
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('ERR_SHIPMENT_NOT_FOUND');
  });

  it('returns 403 when user org cannot access shipment', async () => {
    const res = await request(app)
      .get(`/api/shipments/${SHIPMENT_ID}`)
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER, 'dddddddddddddddddddddddd')}`);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('ERR_PERMISSION_DENIED');
  });

  it('returns 200 with shipment for authorized viewer', async () => {
    const res = await request(app)
      .get(`/api/shipments/${SHIPMENT_ID}`)
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER, ORG_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      _id: SHIPMENT_ID,
      trackingNumber: 'NVN-123456',
      origin: 'NYC',
      destination: 'LA',
    });
  });
});
