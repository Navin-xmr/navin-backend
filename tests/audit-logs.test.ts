import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

import { buildApp } from '../src/app.js';
import { connectMongo } from '../src/infra/mongo/connection.js';
import { AuditLog } from '../src/modules/audit-logs/auditLogs.model.js';

const app = buildApp();

function makeToken(role: string): string {
  return jwt.sign({ userId: 'test-user-id', role }, process.env.JWT_SECRET!);
}

beforeAll(async () => {
  await connectMongo(process.env.MONGO_URI!);
});

afterEach(async () => {
  await AuditLog.deleteMany({});
});

describe('GET /api/audit-logs', () => {
  it('returns 401 when missing bearer token', async () => {
    const response = await request(app).get('/api/audit-logs');
    expect(response.status).toBe(401);
  });

  it('returns 403 for non-admin roles', async () => {
    const response = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${makeToken('MANAGER')}`);

    expect(response.status).toBe(403);
  });

  it('supports filter combinations and cursor pagination', async () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();

    const baseTimestamp = new Date('2026-01-01T10:00:00.000Z');

    await AuditLog.create([
      {
        userId: userA,
        action: 'SHIPMENT_STATUS_CHANGED',
        resource: 'SHIPMENT',
        resourceId: 'shipment-1',
        timestamp: new Date(baseTimestamp.getTime() + 1_000),
        metadata: { previousStatus: 'CREATED', newStatus: 'IN_TRANSIT' },
      },
      {
        userId: userA,
        action: 'SHIPMENT_STATUS_CHANGED',
        resource: 'SHIPMENT',
        resourceId: 'shipment-2',
        timestamp: new Date(baseTimestamp.getTime() + 2_000),
      },
      {
        userId: userB,
        action: 'API_KEY_GENERATED',
        resource: 'API_KEY',
        resourceId: 'key-1',
        timestamp: new Date(baseTimestamp.getTime() + 3_000),
      },
    ]);

    const from = new Date(baseTimestamp.getTime()).toISOString();
    const to = new Date(baseTimestamp.getTime() + 5_000).toISOString();

    const firstPage = await request(app)
      .get('/api/audit-logs')
      .query({
        userId: userA.toString(),
        action: 'SHIPMENT_STATUS_CHANGED',
        resource: 'SHIPMENT',
        from,
        to,
        limit: 1,
      })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.meta.hasMore).toBe(true);
    expect(firstPage.body.meta.total).toBe(2);
    expect(firstPage.body.meta.nextCursor).toBeTruthy();
    expect(firstPage.body.data[0].resource).toBe('SHIPMENT');

    const secondPage = await request(app)
      .get('/api/audit-logs')
      .query({
        userId: userA.toString(),
        action: 'SHIPMENT_STATUS_CHANGED',
        resource: 'SHIPMENT',
        from,
        to,
        limit: 1,
        cursor: firstPage.body.meta.nextCursor,
      })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.meta.hasMore).toBe(false);
    expect(secondPage.body.meta.total).toBe(2);
  });
});
