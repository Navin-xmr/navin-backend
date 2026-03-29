import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import { connectMongo } from '../src/infra/mongo/connection.js';
import { Anomaly } from '../src/modules/anomaly/anomaly.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';
import { UserModel } from '../src/modules/users/users.model.js';
import { env } from '../src/env.js';

const app = buildApp();

let adminToken: string;

beforeAll(async () => {
  await connectMongo(process.env.MONGO_URI!);
  // Create a test admin user
  const adminUser = await UserModel.create({
    email: 'admin@test.com',
    name: 'Admin User',
    passwordHash: 'hashed',
    role: 'ADMIN',
    organizationId: '507f1f77bcf86cd799439011',
  });
  adminToken = jwt.sign(
    { userId: adminUser._id.toString(), role: 'ADMIN', organizationId: '507f1f77bcf86cd799439011' },
    env.JWT_SECRET
  );
});

afterEach(async () => {
  await Anomaly.deleteMany({});
  await Telemetry.deleteMany({});
  await Shipment.deleteMany({});
});

describe('GET /api/anomalies - Cursor Pagination', () => {
  it('should return first page without cursor', async () => {
    const shipment = await Shipment.create({
      trackingNumber: 'TEST001',
      origin: 'A',
      destination: 'B',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
    });

    await Anomaly.create({
      shipmentId: shipment._id,
      timestamp: new Date(),
      type: 'TEMPERATURE_EXCEEDED',
      severity: 'HIGH',
      message: 'Test anomaly',
    });

    const res = await request(app)
      .get('/api/anomalies?limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  it('should paginate correctly with cursor', async () => {
    const shipment = await Shipment.create({
      trackingNumber: 'TEST002',
      origin: 'A',
      destination: 'B',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
    });

    const anomalies = [];
    for (let i = 0; i < 5; i++) {
      const a = await Anomaly.create({
        shipmentId: shipment._id,
        timestamp: new Date(Date.now() + i),
        type: 'TEMPERATURE_EXCEEDED',
        severity: 'HIGH',
        message: `Anomaly ${i}`,
      });
      anomalies.push(a);
    }

    const firstPage = await request(app)
      .get('/api/anomalies?limit=2')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await request(app)
      .get(`/api/anomalies?limit=2&cursor=${firstPage.body.nextCursor}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(2);
    expect(secondPage.body.hasMore).toBe(true);

    const firstPageIds = firstPage.body.data.map((a: { _id: string }) => a._id);
    const secondPageIds = secondPage.body.data.map((a: { _id: string }) => a._id);
    const overlap = firstPageIds.filter((id: string) => secondPageIds.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('should filter by shipmentId', async () => {
    const shipment1 = await Shipment.create({
      trackingNumber: 'TEST003',
      origin: 'A',
      destination: 'B',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
    });

    const shipment2 = await Shipment.create({
      trackingNumber: 'TEST004',
      origin: 'C',
      destination: 'D',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
    });

    await Anomaly.create({
      shipmentId: shipment1._id,
      timestamp: new Date(),
      type: 'TEMPERATURE_EXCEEDED',
      severity: 'HIGH',
      message: 'Anomaly 1',
    });

    await Anomaly.create({
      shipmentId: shipment2._id,
      timestamp: new Date(),
      type: 'TEMPERATURE_EXCEEDED',
      severity: 'HIGH',
      message: 'Anomaly 2',
    });

    const res = await request(app)
      .get(`/api/anomalies?shipmentId=${shipment1._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].shipmentId).toBe(shipment1._id.toString());
  });

  it('should resolve an anomaly', async () => {
    const shipment = await Shipment.create({
      trackingNumber: 'TEST005',
      origin: 'A',
      destination: 'B',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
    });

    const anomaly = await Anomaly.create({
      shipmentId: shipment._id,
      timestamp: new Date(),
      type: 'TEMPERATURE_EXCEEDED',
      severity: 'HIGH',
      message: 'Test anomaly',
      resolved: false,
    });

    const res = await request(app)
      .patch(`/api/anomalies/${anomaly._id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.anomaly.resolved).toBe(true);

    const updated = await Anomaly.findById(anomaly._id);
    expect(updated?.resolved).toBe(true);
  });
});
