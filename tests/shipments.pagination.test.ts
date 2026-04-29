import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import { connectMongo } from '../src/infra/mongo/connection.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';

const app = buildApp();
let authToken: string;

beforeAll(async () => {
  await connectMongo(process.env.MONGO_URI!);
  authToken = jwt.sign(
    { userId: 'test-user-id', role: 'MANAGER' },
    process.env.JWT_SECRET!
  );
});

afterEach(async () => {
  await Shipment.deleteMany({});
});

describe('GET /api/shipments - Cursor Pagination', () => {
  it('should return first page without cursor', async () => {
    await Shipment.create({
      trackingNumber: 'SHIP001',
      origin: 'New York',
      destination: 'Los Angeles',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
    });

    const res = await request(app)
      .get('/api/shipments?limit=10')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.hasMore).toBe(false);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('should paginate correctly with cursor and no duplicates', async () => {
    for (let i = 0; i < 5; i++) {
      await Shipment.create({
        trackingNumber: `SHIP00${i}`,
        origin: 'New York',
        destination: 'Los Angeles',
        enterpriseId: '507f1f77bcf86cd799439011',
        logisticsId: '507f1f77bcf86cd799439012',
      });
    }

    const firstPage = await request(app)
      .get('/api/shipments?limit=2')
      .set('Authorization', `Bearer ${authToken}`);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.meta.hasMore).toBe(true);
    expect(firstPage.body.meta.nextCursor).toBeTruthy();

    const secondPage = await request(app)
      .get(`/api/shipments?limit=2&cursor=${firstPage.body.meta.nextCursor}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(2);

    const firstPageIds = firstPage.body.data.map((s: { _id: string }) => s._id);
    const secondPageIds = secondPage.body.data.map((s: { _id: string }) => s._id);
    const overlap = firstPageIds.filter((id: string) => secondPageIds.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('should filter by status', async () => {
    await Shipment.create({
      trackingNumber: 'SHIP010',
      origin: 'A',
      destination: 'B',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
      status: 'CREATED',
    });

    await Shipment.create({
      trackingNumber: 'SHIP011',
      origin: 'C',
      destination: 'D',
      enterpriseId: '507f1f77bcf86cd799439011',
      logisticsId: '507f1f77bcf86cd799439012',
      status: 'IN_TRANSIT',
    });

    const res = await request(app)
      .get('/api/shipments?status=CREATED')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('CREATED');
  });
});
