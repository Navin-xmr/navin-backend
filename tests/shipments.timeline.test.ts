import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Application } from 'express';
import { env } from '../src/env.js';
import { UserRole } from '../src/shared/constants/index.js';

const ORG_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SHIPMENT_ID = 'cccccccccccccccccccccccc';

type ShipmentRecord = {
  _id: string;
  trackingNumber: string;
  origin: string;
  destination: string;
  enterpriseId: string;
  logisticsId: string;
  status: string;
  milestones: Array<{
    name: string;
    timestamp: Date;
    description?: string;
  }>;
  deliveryProof?: {
    url: string;
    uploadedAt: Date;
  };
};

const shipmentsData: ShipmentRecord[] = [];
const telemetryData: Array<Record<string, unknown>> = [];
const anomalyData: Array<Record<string, unknown>> = [];

await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
  isTokenBlocked: jest.fn(() => Promise.resolve(false)),
  blockToken: jest.fn(),
}));

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
            found ? { enterpriseId: found.enterpriseId, logisticsId: found.logisticsId } : null
          );
        },
      }),
    }),
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({ lean: () => Promise.resolve([]) }),
        }),
      }),
    }),
    countDocuments: () => Promise.resolve(0),
  };

  return { Shipment, ShipmentStatus };
});

await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
  Telemetry: {
    find: (query: { shipmentId?: string; anchorStatus?: string }) => ({
      lean: () =>
        Promise.resolve(
          telemetryData.filter(
            row =>
              (!query.shipmentId || row.shipmentId === query.shipmentId) &&
              (!query.anchorStatus || row.anchorStatus === query.anchorStatus)
          )
        ),
    }),
  },
  TelemetryAnchorStatus: {
    ANCHORED: 'ANCHORED',
  },
}));

await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
  Anomaly: {
    find: (query: { shipmentId?: string }) => ({
      lean: () => Promise.resolve(anomalyData.filter(row => row.shipmentId === query.shipmentId)),
    }),
  },
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
  emitPaymentStatusChange: jest.fn(),
}));

const { buildApp } = await import('../src/app.js');

function tokenFor(role: string) {
  return jwt.sign(
    { userId: 'user-1', role, organizationId: ORG_A, jti: randomUUID() },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('GET /api/shipments/:id/timeline', () => {
  let app: Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    shipmentsData.length = 0;
    telemetryData.length = 0;
    anomalyData.length = 0;

    shipmentsData.push({
      _id: SHIPMENT_ID,
      trackingNumber: 'NVN-100001',
      origin: 'NYC',
      destination: 'LA',
      enterpriseId: ORG_A,
      logisticsId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'IN_TRANSIT',
      milestones: [
        {
          name: 'CREATED',
          timestamp: new Date('2026-01-01T10:00:00.000Z'),
          description: 'Shipment created',
        },
        {
          name: 'IN_TRANSIT',
          timestamp: new Date('2026-01-02T10:00:00.000Z'),
        },
      ],
      deliveryProof: {
        url: 'https://example.com/proof.jpg',
        uploadedAt: new Date('2026-01-04T10:00:00.000Z'),
      },
    });

    telemetryData.push({
      _id: 'tel1',
      shipmentId: SHIPMENT_ID,
      anchorStatus: 'ANCHORED',
      timestamp: new Date('2026-01-03T10:00:00.000Z'),
      stellarTxHash: 'tx-1',
      dataHash: 'hash-1',
    });

    anomalyData.push({
      _id: 'an1',
      shipmentId: SHIPMENT_ID,
      type: 'BATTERY_LOW',
      severity: 'MEDIUM',
      message: 'Battery low',
      timestamp: new Date('2026-01-03T12:00:00.000Z'),
      resolved: false,
    });
  });

  it('returns empty timeline for new shipment with no events', async () => {
    shipmentsData[0].milestones = [];
    shipmentsData[0].deliveryProof = undefined;
    telemetryData.length = 0;
    anomalyData.length = 0;

    const res = await request(app)
      .get(`/api/shipments/${SHIPMENT_ID}/timeline`)
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns mixed events sorted chronologically', async () => {
    const res = await request(app)
      .get(`/api/shipments/${SHIPMENT_ID}/timeline`)
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    const types = res.body.data.map((event: { type: string }) => event.type);
    expect(types).toEqual([
      'STATUS_CHANGE',
      'STATUS_CHANGE',
      'TELEMETRY_ANCHORED',
      'ANOMALY_DETECTED',
      'PROOF_UPLOADED',
    ]);
  });

  it('supports cursor pagination', async () => {
    const first = await request(app)
      .get(`/api/shipments/${SHIPMENT_ID}/timeline?limit=2`)
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);

    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.hasMore).toBe(true);

    const second = await request(app)
      .get(
        `/api/shipments/${SHIPMENT_ID}/timeline?limit=2&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`
      )
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);

    expect(second.status).toBe(200);
    expect(second.body.data.length).toBeGreaterThan(0);
  });
});
