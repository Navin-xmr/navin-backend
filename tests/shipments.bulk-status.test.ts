import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import process from 'process';
import type { Application } from 'express';

type ShipmentRecord = {
  _id: string;
  status: string;
  milestones: Array<{
    name: string;
    timestamp: Date;
    description?: string;
    userId?: string;
    walletAddress?: string;
  }>;
  enterpriseId: string;
  logisticsId: string;
  save?: () => Promise<ShipmentRecord>;
};

const shipmentsData: ShipmentRecord[] = [];

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
  const ShipmentConstructor = {
    new (doc: Record<string, unknown>) {
      const s = { ...doc, milestones: [], save: async () => s } as unknown as ShipmentRecord;
      return s;
    },
    find: (query: { _id?: { $in: string[] }; $or?: Array<{ enterpriseId?: string; logisticsId?: string }> }) => {
      const ids = query._id?.$in;
      const orgId = query.$or?.[0]?.enterpriseId ?? query.$or?.[1]?.logisticsId;
      let result = shipmentsData;
      if (ids) {
        result = result.filter(d => ids.includes(String(d._id)));
      }
      if (orgId) {
        result = result.filter(
          d => String(d.enterpriseId) === String(orgId) || String(d.logisticsId) === String(orgId)
        );
      }
      return {
        select: () => ({
          lean: () => Promise.resolve(result),
        }),
        lean: () => Promise.resolve(result),
      };
    },
    findById: (id: string) => {
      const found = shipmentsData.find(d => String(d._id) === String(id));
      if (!found) return Promise.resolve(null);
      const doc = { ...found, save: async () => doc } as ShipmentRecord;
      return Promise.resolve(doc);
    },
    findByIdAndUpdate: (id: string) => {
      const idx = shipmentsData.findIndex(d => String(d._id) === String(id));
      if (idx === -1) return Promise.resolve(null);
      return Promise.resolve(shipmentsData[idx]);
    },
    countDocuments: () => Promise.resolve(shipmentsData.length),
    deleteMany: () => {
      shipmentsData.length = 0;
      return Promise.resolve();
    },
    prototype: {
      save: async function (this: ShipmentRecord) {
        const idx = shipmentsData.findIndex(d => String(d._id) === String(this._id));
        if (idx !== -1) shipmentsData[idx] = this;
        return this;
      },
    },
  };

  const ShipmentStatus = {
    CREATED: 'CREATED',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  };

  return { Shipment: ShipmentConstructor, ShipmentStatus };
});

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    findById: () =>
      Promise.resolve({
        walletAddress: '0xABC123',
      }),
  },
}));

await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
  tokenizeShipment: jest.fn(),
  releaseEscrow: jest.fn(() => Promise.resolve({ success: true, transactionHash: 'mock-tx-hash' })),
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  initSocketIO: jest.fn(),
  getIO: jest.fn(),
  emitStatusUpdate: jest.fn(),
}));

await jest.unstable_mockModule('../src/modules/analytics/analytics.cache.js', () => ({
  invalidateAnalyticsPerformanceCache: jest.fn(),
}));

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentByShipmentId: jest.fn(() => Promise.resolve(null)),
  updatePaymentStatus: jest.fn(),
}));

describe('Bulk Status Update API', () => {
  let app: Application;
  let buildApp: () => Application;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    buildApp = appModule.buildApp as () => Application;
    app = buildApp();
  });

  beforeEach(async () => {
    shipmentsData.length = 0;
  });

  const generateToken = (payload: { userId?: string; role?: string; organizationId?: string }) =>
    jwt.sign(payload, process.env.JWT_SECRET!);

  it('should return 401 when not authenticated', async () => {
    const res = await request(app)
      .patch('/api/shipments/bulk/status')
      .send({ shipmentIds: ['1'], status: 'IN_TRANSIT' });
    expect(res.status).toBe(401);
  });

  it('should return 403 for VIEWER role', async () => {
    const token = generateToken({ userId: 'viewer-1', role: 'VIEWER', organizationId: 'org1' });
    const res = await request(app)
      .patch('/api/shipments/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipmentIds: ['1'], status: 'IN_TRANSIT' });
    expect(res.status).toBe(403);
  });

  it('should return 200 for MANAGER role', async () => {
    const token = generateToken({ userId: 'manager-1', role: 'MANAGER', organizationId: 'org1' });
    const res = await request(app)
      .patch('/api/shipments/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipmentIds: [], status: 'IN_TRANSIT' });
    expect(res.status).toBe(200);
  });

  it('should return 400 when shipmentIds array is empty', async () => {
    const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });
    const res = await request(app)
      .patch('/api/shipments/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipmentIds: [], status: 'IN_TRANSIT' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('shipmentIds');
  });

  it('should return 400 when shipmentIds exceeds 50 items', async () => {
    const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });
    const res = await request(app)
      .patch('/api/shipments/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipmentIds: Array(51).fill('id'), status: 'IN_TRANSIT' });
    expect(res.status).toBe(400);
  });

  it('should update all valid shipments successfully', async () => {
    const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });

    shipmentsData.push(
      { _id: 's1', status: 'CREATED', enterpriseId: 'org1', logisticsId: 'org2', milestones: [] },
      { _id: 's2', status: 'CREATED', enterpriseId: 'org1', logisticsId: 'org2', milestones: [] },
      { _id: 's3', status: 'CREATED', enterpriseId: 'org1', logisticsId: 'org2', milestones: [] }
    );

    const res = await request(app)
      .patch('/api/shipments/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipmentIds: ['s1', 's2', 's3'], status: 'IN_TRANSIT' });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(3);
    expect(res.body.data.failed).toHaveLength(0);
  });

  it('should return partial results with failed items', async () => {
    const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });

    shipmentsData.push(
      { _id: 's1', status: 'CREATED', enterpriseId: 'org1', logisticsId: 'org2', milestones: [] },
      { _id: 's2', status: 'DELIVERED', enterpriseId: 'org1', logisticsId: 'org2', milestones: [] },
      { _id: 's3', status: 'CREATED', enterpriseId: 'wrong-org', logisticsId: 'org2', milestones: [] }
    );

    const res = await request(app)
      .patch('/api/shipments/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipmentIds: ['s1', 's2', 's3', 's-nonexistent'], status: 'IN_TRANSIT' });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.failed).toHaveLength(3);

    const reasons = res.body.data.failed.map((f: { id: string; reason: string }) => f.reason);
    expect(reasons).toContain('NOT_FOUND');
    expect(reasons).toContain('INVALID_TRANSITION');
    expect(reasons).toContain('WRONG_ORG');
  });

  it('should not rollback successful updates on partial failures', async () => {
    const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });

    shipmentsData.push(
      { _id: 's1', status: 'CREATED', enterpriseId: 'org1', logisticsId: 'org2', milestones: [] },
      { _id: 's2', status: 'DELIVERED', enterpriseId: 'org1', logisticsId: 'org2', milestones: [] }
    );

    await request(app)
      .patch('/api/shipments/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipmentIds: ['s1', 's2'], status: 'IN_TRANSIT' });

    const s1 = shipmentsData.find(d => d._id === 's1');
    expect(s1?.status).toBe('IN_TRANSIT');
  });

  it('should emit status_update events for successful updates', async () => {
    const token = generateToken({ userId: 'admin-1', role: 'ADMIN', organizationId: 'org1' });
    const ioModule = await import('../src/infra/socket/io.js');

    shipmentsData.push({ _id: 's1', status: 'CREATED', enterpriseId: 'org1', logisticsId: 'org2', milestones: [] });

    await request(app)
      .patch('/api/shipments/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipmentIds: ['s1'], status: 'IN_TRANSIT' });

    expect(ioModule.emitStatusUpdate).toHaveBeenCalled();
  });
});