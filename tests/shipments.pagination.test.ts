import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import request from 'supertest';
import { Types } from 'mongoose';
import { signToken } from './fixtures/factories.js';
import { buildApp } from '../src/app.js';
import { connectMongo } from '../src/infra/mongo/connection.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';

// ---------------------------------------------------------------------------
// Unique fixture namespace – keeps this suite's documents invisible to every
// other test file and vice-versa, regardless of execution order or parallelism.
// ---------------------------------------------------------------------------
const FIXTURE_ORG_ID = new Types.ObjectId().toHexString();
const FIXTURE_LOGISTICS_ID = new Types.ObjectId().toHexString();

// Tracking-number prefix that is statistically unique per run.
const TRK_PREFIX = `PAG-${FIXTURE_ORG_ID.slice(-6)}-`;

// The JWT carries organizationId so the controller's `filters.organizationId`
// is always set, scoping every DB query to FIXTURE_ORG_ID only.
let authToken: string;

const app = buildApp();

beforeAll(async () => {
  await connectMongo(process.env.MONGO_URI!);
  authToken = signToken({
    userId: 'pagination-test-user',
    role: 'MANAGER',
    organizationId: FIXTURE_ORG_ID,
  });
});

// Clean up only this suite's own documents – leaves other suites' data intact.
afterEach(async () => {
  await Shipment.deleteMany({ enterpriseId: FIXTURE_ORG_ID });
});

// Helper: create a shipment that belongs unambiguously to this suite.
function makeShipment(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    trackingNumber: `${TRK_PREFIX}${suffix}`,
    origin: 'New York',
    destination: 'Los Angeles',
    enterpriseId: FIXTURE_ORG_ID,
    logisticsId: FIXTURE_LOGISTICS_ID,
    ...extra,
  };
}

describe('GET /api/shipments - Offset Pagination', () => {
  it('should return first page with exactly the seeded record', async () => {
    await Shipment.create(makeShipment('001'));

    const res = await request(app)
      .get('/api/shipments?limit=10')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(10);
    expect(res.body.meta.total).toBe(1);
  });

  it('should paginate correctly with page parameter and no duplicates', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => Shipment.create(makeShipment(`P${i}`)))
    );

    const firstPage = await request(app)
      .get('/api/shipments?limit=2&page=1')
      .set('Authorization', `Bearer ${authToken}`);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.meta.total).toBe(5);
    expect(firstPage.body.meta.page).toBe(1);

    const secondPage = await request(app)
      .get('/api/shipments?limit=2&page=2')
      .set('Authorization', `Bearer ${authToken}`);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(2);

    const firstPageIds = firstPage.body.data.map((s: { _id: string }) => s._id);
    const secondPageIds = secondPage.body.data.map((s: { _id: string }) => s._id);
    const overlap = firstPageIds.filter((id: string) => secondPageIds.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('should filter by status and return only matching records', async () => {
    await Shipment.create(makeShipment('S010', { status: 'CREATED' }));
    await Shipment.create(makeShipment('S011', { status: 'IN_TRANSIT' }));

    const res = await request(app)
      .get('/api/shipments?status=CREATED')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('CREATED');
  });
});
