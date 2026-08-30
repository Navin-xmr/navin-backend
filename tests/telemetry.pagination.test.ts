import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import { connectMongo } from '../src/infra/mongo/connection.js';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import { UserModel } from '../src/modules/users/users.model.js';
import { env } from '../src/env.js';

const app = buildApp();

let adminToken: string;

beforeAll(async () => {
  await connectMongo(process.env.MONGO_URI!);
  const adminUser = await UserModel.create({
    email: 'telemetry-pagination-admin@test.com',
    name: 'Telemetry Pagination Admin',
    passwordHash: 'hashed',
    role: 'ADMIN',
    organizationId: '507f1f77bcf86cd799439011',
  });
  adminToken = jwt.sign({ userId: adminUser._id.toString(), role: 'ADMIN' }, env.JWT_SECRET);
});

afterEach(async () => {
  await Telemetry.deleteMany({});
  await Shipment.deleteMany({});
});

describe('GET /api/telemetry - Cursor Pagination', () => {
  it('should return first page without cursor', async () => {
    const shipment = await Shipment.create({
      trackingNumber: 'TEST005',
      origin: 'A',
      destination: 'B',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
    });

    await Telemetry.create({
      sensorId: 'sensor-1',
      shipmentId: shipment._id,
      temperature: 25,
      humidity: 60,
      latitude: 10,
      longitude: 20,
      batteryLevel: 90,
      timestamp: new Date(),
      dataHash: 'hash5',
      stellarTxHash: 'tx5',
      rawPayload: {},
    });

    const res = await request(app)
      .get('/api/telemetry?limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.hasMore).toBe(false);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('should paginate correctly with cursor and no duplicates', async () => {
    const shipment = await Shipment.create({
      trackingNumber: 'TEST006',
      origin: 'A',
      destination: 'B',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
    });

    for (let i = 0; i < 5; i++) {
      await Telemetry.create({
        sensorId: 'sensor-1',
        shipmentId: shipment._id,
        temperature: 20 + i,
        humidity: 60,
        latitude: 10,
        longitude: 20,
        batteryLevel: 90,
        timestamp: new Date(Date.now() + i * 1000),
        dataHash: `hash${i}`,
        stellarTxHash: `tx${i}`,
        rawPayload: {},
      });
    }

    const firstPage = await request(app)
      .get('/api/telemetry?limit=2')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.meta.hasMore).toBe(true);
    expect(firstPage.body.meta.nextCursor).toBeTruthy();

    const secondPage = await request(app)
      .get(`/api/telemetry?limit=2&cursor=${firstPage.body.meta.nextCursor}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(2);

    const firstPageIds = firstPage.body.data.map((t: { _id: string }) => t._id);
    const secondPageIds = secondPage.body.data.map((t: { _id: string }) => t._id);
    const overlap = firstPageIds.filter((id: string) => secondPageIds.includes(id));
    expect(overlap).toHaveLength(0);
  });
});
