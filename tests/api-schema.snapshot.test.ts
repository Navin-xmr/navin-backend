import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import { createChainFactoryMock } from './helpers/mocks.js';
import request from 'supertest';
import type { Application } from 'express';
import { signToken } from './fixtures/factories.js';

type ShipmentRecord = { _id: string; status?: string; milestones: unknown[] } & Record<
  string,
  unknown
>;
type AnomalyRecord = { _id: string; shipmentId: string; severity?: string } & Record<
  string,
  unknown
>;
type UserRecord = { _id: string; role?: string; walletAddress?: string } & Record<string, unknown>;
type SnapshotQuery = {
  _id?: { $lt?: string | number };
  status?: string;
  shipmentId?: string;
  severity?: string;
};
type ShipmentConstructorMock = {
  new (doc: Record<string, unknown>): ShipmentRecord;
  find: (query?: SnapshotQuery) => {
    sort: () => {
      skip: (skip: number) => { limit: (limit: number) => { lean: () => Promise<ShipmentRecord[]> } };
      limit: (limit: number) => { lean: () => Promise<ShipmentRecord[]> };
    };
  };
  countDocuments: () => Promise<number>;
  deleteMany: () => Promise<void>;
};

const shipmentsData: ShipmentRecord[] = [];
const anomaliesData: AnomalyRecord[] = [];
const usersData: UserRecord[] = [];

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
  const ShipmentConstructor = function (this: ShipmentRecord, doc: Record<string, unknown>) {
    Object.assign(this, doc);
    this.milestones = [];
  } as unknown as ShipmentConstructorMock;

  ShipmentConstructor.find = (query: SnapshotQuery = {}) => {
    const cursor = query?._id?.$lt;
    const status = query?.status;
    const arr = shipmentsData
      .filter(d => (status ? d.status === status : true))
      .filter(d => (cursor ? Number(d._id) < Number(cursor) : true))
      .sort((a, b) => Number(b._id) - Number(a._id));

    return {
      sort: () => ({
        skip: (s: number) => ({
          limit: (l: number) => ({
            lean: () => Promise.resolve(arr.slice(s, s + l)),
          }),
        }),
        limit: (l: number) => ({
          lean: () => Promise.resolve(arr.slice(0, l)),
        }),
      }),
    };
  };

  ShipmentConstructor.countDocuments = () => Promise.resolve(shipmentsData.length);
  ShipmentConstructor.deleteMany = () => {
    shipmentsData.length = 0;
    return Promise.resolve();
  };

  const ShipmentStatus = {
    CREATED: 'CREATED',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  };
  return { Shipment: ShipmentConstructor, ShipmentStatus };
});

await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => {
  const AnomalyConstructor = {
    find: (query: SnapshotQuery = {}) => {
      const cursor = query?._id?.$lt;
      const shipmentId = query?.shipmentId;
      const severity = query?.severity;
      const arr = anomaliesData
        .filter(d => (shipmentId ? d.shipmentId === shipmentId : true))
        .filter(d => (severity ? d.severity === severity : true))
        .filter(d => (cursor ? Number(d._id) < Number(cursor) : true))
        .sort((a, b) => Number(b._id) - Number(a._id));

      return {
        select: () => ({
          sort: () => ({
            limit: (l: number) => ({
              lean: () => Promise.resolve(arr.slice(0, l)),
            }),
          }),
        }),
      };
    },
    deleteMany: () => {
      anomaliesData.length = 0;
      return Promise.resolve();
    },
  };

  return {
    Anomaly: AnomalyConstructor,
    ANOMALY_SEVERITIES: ['LOW', 'MEDIUM', 'HIGH'],
    ANOMALY_TYPES: ['TEMPERATURE_EXCEEDED'],
  };
});

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => {
  const UserModel = {
    create: (u: Record<string, unknown>) => {
      const user = { ...u, _id: String(usersData.length) };
      usersData.push(user as UserRecord);
      return Promise.resolve(user);
    },
    findById: (id: string) =>
      Promise.resolve(usersData.find(u => String(u._id) === String(id)) || null),
  };
  const OrganizationModel = {
    findById: () => Promise.resolve(null),
  };
  const UserRole = {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    VIEWER: 'VIEWER',
    CUSTOMER: 'CUSTOMER',
  };
  const OrganizationType = {
    ENTERPRISE: 'ENTERPRISE',
    LOGISTICS: 'LOGISTICS',
  };
  return { UserModel, OrganizationModel, UserRole, OrganizationType };
});

await jest.unstable_mockModule('../src/services/chain/factory.js', () => createChainFactoryMock());

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  initSocketIO: jest.fn(),
  getIO: jest.fn(),
  emitAnomalyDetected: jest.fn(),
  emitTelemetryUpdate: jest.fn(),
      emitPaymentStatusChange: jest.fn(),
  emitStatusUpdate: jest.fn(),
}));

describe('API Schema Snapshot Tests', () => {
  let app: Application;
  let authToken: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = (appModule.buildApp as () => Application)();

    const users = await import('../src/modules/users/users.model.js');
    const user = await users.UserModel.create({
      email: 'admin@test.com',
      name: 'Admin',
      passwordHash: 'hash',
      role: 'ADMIN',
      organizationId: 'org1',
      walletAddress: '0xABC',
    });

    authToken = signToken({ userId: String(user._id), role: user.role });
  });

  beforeEach(() => {
    shipmentsData.length = 0;
    anomaliesData.length = 0;
  });

  describe('GET /api/shipments', () => {
    it('should match response schema snapshot', async () => {
      shipmentsData.push({
        _id: '1',
        trackingNumber: 'TN001',
        origin: 'New York',
        destination: 'Los Angeles',
        enterpriseId: 'ent1',
        logisticsId: 'log1',
        status: 'IN_TRANSIT',
        milestones: [],
      });

      const res = await request(app)
        .get('/api/shipments?limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchSnapshot();
    });
  });

  describe('GET /api/anomalies', () => {
    it('should match response schema snapshot', async () => {
      anomaliesData.push({
        _id: '1',
        shipmentId: 'ship1',
        type: 'TEMPERATURE_EXCEEDED',
        severity: 'HIGH',
        message: 'Temperature exceeded threshold',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        resolved: false,
      });

      const res = await request(app)
        .get('/api/anomalies?limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchSnapshot();
    });
  });
});
