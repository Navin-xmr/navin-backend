import { jest } from '@jest/globals';
import request from 'supertest';

// Mock in-memory DB for shipments
const shipmentsData: any[] = [];
const usersData: any[] = [];

await jest.unstable_mockModule('../src/modules/shipments/shipments.model', () => {
  function ShipmentConstructor(this: any, doc: any) {
    Object.assign(this, doc);
    this.milestones = doc.milestones || [];
  }

  ShipmentConstructor.find = (query: any) => {
    const arr = shipmentsData.filter(d => !query || !query.status || d.status === query.status);
    return {
      skip: (s: number) => ({
        limit: (l: number) => Promise.resolve(arr.slice(s, s + l)),
      }),
    };
  };

  ShipmentConstructor.countDocuments = (query: any) =>
    Promise.resolve(shipmentsData.filter(d => !query || !query.status || d.status === query.status).length);

  ShipmentConstructor.deleteMany = () => {
    shipmentsData.length = 0;
    return Promise.resolve();
  };

  ShipmentConstructor.create = (doc: any) => {
    const d = { ...doc, _id: String(shipmentsData.length), milestones: doc.milestones || [] };
    shipmentsData.push(d);
    return Promise.resolve(d);
  };

  ShipmentConstructor.findById = (id: any) => {
    const found = shipmentsData.find(d => String(d._id) === String(id));
    if (!found) return Promise.resolve(null);
    return Promise.resolve({
      ...found,
      save: async function () {
        const idx = shipmentsData.findIndex(d => String(d._id) === String(this._id));
        if (idx !== -1) {
          shipmentsData[idx] = { ...this };
        }
        return this;
      },
    });
  };

  ShipmentConstructor.findByIdAndUpdate = (id: any, update: any, opts: any) => {
    const idx = shipmentsData.findIndex(d => String(d._id) === String(id));
    if (idx === -1) return Promise.resolve(null);
    shipmentsData[idx] = { ...shipmentsData[idx], ...update };
    return Promise.resolve(opts?.new ? shipmentsData[idx] : null);
  };

  ShipmentConstructor.prototype.save = async function () {
    const idx = shipmentsData.findIndex(d => String(d._id) === String(this._id));
    if (idx !== -1) {
      shipmentsData[idx] = { ...this };
    } else {
      this._id = String(shipmentsData.length);
      shipmentsData.push({ ...this });
    }
    return this;
  };

  const ShipmentStatus = { CREATED: 'CREATED', IN_TRANSIT: 'IN_TRANSIT', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED' };
  return { Shipment: ShipmentConstructor, ShipmentStatus };
});

await jest.unstable_mockModule('../src/modules/users/users.model', () => {
  const UserModel = {
    create: (u: any) => {
      const user = { ...u, _id: String(usersData.length) };
      usersData.push(user);
      return Promise.resolve(user);
    },
    findById: (id: any) => Promise.resolve(usersData.find(u => String(u._id) === String(id)) || null),
  };
  return { UserModel };
});

describe('Shipments API (mocked DB)', () => {
  let app: any;
  let buildApp: any;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    buildApp = appModule.buildApp;
    app = buildApp();
  });

  beforeEach(async () => {
    shipmentsData.length = 0;
    usersData.length = 0;
  });

  it('should paginate shipments', async () => {
    for (let i = 0; i < 15; i++) {
      await (await import('../src/modules/shipments/shipments.model')).Shipment.create({
        trackingNumber: `TN${i}`,
        origin: 'A',
        destination: 'B',
        enterpriseId: `ent${i}`,
        logisticsId: `log${i}`,
        status: 'CREATED',
      });
    }
    const res = await request(app).get('/api/shipments?page=2&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);
    expect(res.body.page).toBe(2);
    expect(res.body.total).toBe(15);
  });

  it('should filter shipments by status', async () => {
    const mod = await import('../src/modules/shipments/shipments.model');
    await mod.Shipment.create({ trackingNumber: 'TN1', origin: 'A', destination: 'B', enterpriseId: 'ent1', logisticsId: 'log1', status: 'IN_TRANSIT' });
    await mod.Shipment.create({ trackingNumber: 'TN2', origin: 'A', destination: 'B', enterpriseId: 'ent2', logisticsId: 'log2', status: 'DELIVERED' });
    const res = await request(app).get('/api/shipments?status=IN_TRANSIT');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('IN_TRANSIT');
  });

  it('should append milestone on status change and record user/wallet', async () => {
    const users = await import('../src/modules/users/users.model');
    const mod = await import('../src/modules/shipments/shipments.model');

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
});
