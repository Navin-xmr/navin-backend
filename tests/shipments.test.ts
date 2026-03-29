import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import request from 'supertest';
import process from 'process';
import type { Application } from 'express';

// Mock in-memory DB for shipments
type PrimitiveId = string | number;
type MilestoneRecord = Record<string, unknown>;
type ShipmentRecord = {
  _id: string;
  status?: string;
  milestones: MilestoneRecord[];
} & Record<string, unknown>;
type UserRecord = {
  _id: string;
  role?: string;
  walletAddress?: string;
} & Record<string, unknown>;

const shipmentsData: ShipmentRecord[] = [];
const usersData: UserRecord[] = [];

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
  type ShipmentInput = Record<string, unknown> & { milestones?: MilestoneRecord[] };
  type ShipmentQuery = { _id?: { $lt?: PrimitiveId }; status?: string };
  type FindChain = {
    sort: () => {
      limit: (l: number) => {
        lean: () => Promise<ShipmentRecord[]>;
      };
    };
  };
  type ShipmentCtor = {
    new (doc: ShipmentInput): ShipmentRecord;
    find: (query?: ShipmentQuery) => FindChain;
    countDocuments: (query?: { status?: string }) => Promise<number>;
    deleteMany: () => Promise<void>;
    create: (doc: ShipmentInput) => Promise<ShipmentRecord>;
    findById: (id: PrimitiveId) => Promise<(ShipmentRecord & { save: () => Promise<ShipmentRecord> }) | null>;
    findByIdAndUpdate: (id: PrimitiveId, update: Record<string, unknown>, opts?: { new?: boolean }) => Promise<ShipmentRecord | null>;
    prototype: {
      save: (this: ShipmentRecord) => Promise<ShipmentRecord>;
    };
  };

  const ShipmentConstructor = function (this: ShipmentRecord, doc: ShipmentInput) {
    Object.assign(this, doc);
    this.milestones = doc.milestones || [];
  } as unknown as ShipmentCtor;

  ShipmentConstructor.find = (query = {}) => {
    const cursor = query?._id?.$lt;
    const status = query?.status;
    const arr = shipmentsData
      .filter(d => (status ? d.status === status : true))
      .filter(d => (cursor ? Number(d._id) < Number(cursor) : true))
      .sort((a, b) => Number(b._id) - Number(a._id));

    return {
      sort: () => ({
        limit: (l: number) => ({
          lean: () => Promise.resolve(arr.slice(0, l)),
        }),
      }),
    };
  };

  ShipmentConstructor.countDocuments = (query) =>
    Promise.resolve(shipmentsData.filter(d => !query || !query.status || d.status === query.status).length);

  ShipmentConstructor.deleteMany = () => {
    shipmentsData.length = 0;
    return Promise.resolve();
  };

  ShipmentConstructor.create = (doc) => {
    const d = { ...doc, _id: String(shipmentsData.length), milestones: doc.milestones || [] };
    shipmentsData.push(d as ShipmentRecord);
    return Promise.resolve(d);
  };

  ShipmentConstructor.findById = (id) => {
    const found = shipmentsData.find(d => String(d._id) === String(id));
    if (!found) return Promise.resolve(null);
    return Promise.resolve({
      ...found,
      save: async function () {
        const idx = shipmentsData.findIndex(d => String(d._id) === String(this._id));
        if (idx !== -1) {
          shipmentsData[idx] = { ...this } as ShipmentRecord;
        }
        return this as ShipmentRecord;
      },
    });
  };

  ShipmentConstructor.findByIdAndUpdate = (id, update, opts) => {
    const idx = shipmentsData.findIndex(d => String(d._id) === String(id));
    if (idx === -1) return Promise.resolve(null);
    shipmentsData[idx] = { ...shipmentsData[idx], ...update } as ShipmentRecord;
    return Promise.resolve(opts?.new ? shipmentsData[idx] : null);
  };

  ShipmentConstructor.prototype.save = async function () {
    const idx = shipmentsData.findIndex(d => String(d._id) === String(this._id));
    if (idx !== -1) {
      shipmentsData[idx] = { ...this } as ShipmentRecord;
    } else {
      this._id = String(shipmentsData.length);
      shipmentsData.push({ ...this } as ShipmentRecord);
    }
    return this;
  };

  const ShipmentStatus = { CREATED: 'CREATED', IN_TRANSIT: 'IN_TRANSIT', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED' };
  return { Shipment: ShipmentConstructor, ShipmentStatus };
});

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => {
  const UserModel = {
    create: (u: Record<string, unknown>) => {
      const user = { ...u, _id: String(usersData.length) };
      usersData.push(user as UserRecord);
      return Promise.resolve(user);
    },
    findById: (id: PrimitiveId) => Promise.resolve(usersData.find(u => String(u._id) === String(id)) || null),
  };
  return { UserModel };
});

await jest.unstable_mockModule('../src/infra/socket/io.js', () => {
  return {
    initSocketIO: jest.fn(),
    getIO: jest.fn(),
    emitAnomalyDetected: jest.fn(),
    emitTelemetryUpdate: jest.fn(),
    emitStatusUpdate: jest.fn(),
  };
});

describe('Shipments API (mocked DB)', () => {
  let app: Application;
  let buildApp: () => Application;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    buildApp = appModule.buildApp as () => Application;
    app = buildApp();
  });

  beforeEach(async () => {
    shipmentsData.length = 0;
    usersData.length = 0;
  });

  it('should paginate shipments', async () => {
    for (let i = 0; i < 15; i++) {
      await (await import('../src/modules/shipments/shipments.model.js')).Shipment.create({
        trackingNumber: `TN${i}`,
        origin: 'A',
        destination: 'B',
        enterpriseId: `ent${i}`,
        logisticsId: `log${i}`,
        status: 'CREATED',
      });
    }
    const first = await request(app).get('/api/shipments?limit=5');
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(5);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app).get(`/api/shipments?limit=5&cursor=${first.body.nextCursor}`);
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(5);
    const firstIds = first.body.data.map((s: { _id: string }) => s._id);
    const secondIds = second.body.data.map((s: { _id: string }) => s._id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);
  });

  it('should filter shipments by status', async () => {
    const mod = await import('../src/modules/shipments/shipments.model.js');
    await mod.Shipment.create({ trackingNumber: 'TN1', origin: 'A', destination: 'B', enterpriseId: 'ent1', logisticsId: 'log1', status: 'IN_TRANSIT' });
    await mod.Shipment.create({ trackingNumber: 'TN2', origin: 'A', destination: 'B', enterpriseId: 'ent2', logisticsId: 'log2', status: 'DELIVERED' });
    const res = await request(app).get('/api/shipments?status=IN_TRANSIT&limit=20');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('IN_TRANSIT');
  });

  it('should append milestone on status change and record user/wallet', async () => {
    const users = await import('../src/modules/users/users.model.js');
    const mod = await import('../src/modules/shipments/shipments.model.js');

    const user = await users.UserModel.create({
      email: 'test@example.com',
      name: 'Tester',
      passwordHash: 'password',
      role: 'MANAGER',
      organizationId: 'org1',
      walletAddress: '0xABC123',
    });

    // create shipment
    const shipment = await mod.Shipment.create({
      trackingNumber: 'TN-STATUS',
      origin: 'A',
      destination: 'B',
      enterpriseId: 'ent1',
      logisticsId: 'log1',
      status: 'CREATED',
      milestones: [],
    });

    // generate token matching auth.service.verifyToken expectations
    const tokenPayload = { userId: String(user._id), role: user.role };
    const { default: { sign } } = await import('jsonwebtoken');
    const token = sign(tokenPayload, process.env.JWT_SECRET!);

    const res = await request(app)
      .patch(`/api/shipments/${shipment._id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_TRANSIT' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_TRANSIT');
    expect(res.body.milestones).toBeDefined();
    expect(res.body.milestones.length).toBe(1);
    const ms = res.body.milestones[0];
    expect(ms.name).toBe('IN_TRANSIT');
    expect(ms.walletAddress).toBe('0xABC123');
    expect(ms.userId).toBeDefined();
  });

  it('should return 401 when trying to create a shipment without a token', async () => {
    const res = await request(app).post('/api/shipments').send({});
    expect(res.status).toBe(401);
  });

  it('should return 403 when trying to create a shipment as a VIEWER', async () => {
    const users = await import('../src/modules/users/users.model.js');
    const user = await users.UserModel.create({
      email: 'viewer2@example.com',
      name: 'Viewer',
      passwordHash: 'password',
      role: 'VIEWER',
      organizationId: 'org1',
      walletAddress: '0xABC123',
    });

    const tokenPayload = { userId: String(user._id), role: user.role };
    const { default: { sign } } = await import('jsonwebtoken');
    const token = sign(tokenPayload, process.env.JWT_SECRET || 'secret');

    const res = await request(app)
      .post('/api/shipments')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('should create a shipment successfully as a MANAGER', async () => {
    const users = await import('../src/modules/users/users.model.js');
    const user = await users.UserModel.create({
      email: 'manager2@example.com',
      name: 'Manager',
      passwordHash: 'password',
      role: 'MANAGER',
      organizationId: 'org1',
      walletAddress: '0xABC123',
    });

    const tokenPayload = { userId: String(user._id), role: user.role };
    const { default: { sign } } = await import('jsonwebtoken');
    const token = sign(tokenPayload, process.env.JWT_SECRET || 'secret');

    const res = await request(app)
      .post('/api/shipments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        trackingNumber: 'TN-NEW-1',
        origin: 'A',
        destination: 'B',
        enterpriseId: 'ent1',
        logisticsId: 'log1',
        status: 'CREATED'
      });
    expect(res.status).toBe(201);
    expect(res.body.trackingNumber).toBe('TN-NEW-1');
  });
});
