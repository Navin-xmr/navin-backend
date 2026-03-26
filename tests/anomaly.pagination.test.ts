import request from 'supertest';
import { buildApp } from '../src/app.js';
import { connectMongo } from '../src/infra/mongo/connection.js';
import { Anomaly } from '../src/modules/anomaly/anomaly.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';

const app = buildApp();

beforeAll(async () => {
  await connectMongo(process.env.MONGO_URI!);
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

    const res = await request(app).get('/api/anomalies?limit=10');

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

    const firstPage = await request(app).get('/api/anomalies?limit=2');
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await request(app).get(`/api/anomalies?limit=2&cursor=${firstPage.body.nextCursor}`);
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

    const res = await request(app).get(`/api/anomalies?shipmentId=${shipment1._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].shipmentId).toBe(shipment1._id.toString());
  });
});
