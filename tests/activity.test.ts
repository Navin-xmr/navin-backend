import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

import { buildApp } from '../src/app.js';
import { AuditLog } from '../src/modules/audit-logs/auditLogs.model.js';

const app = buildApp();

function makeToken(role: string, userId = 'user-000000000000000000000001'): string {
  return jwt.sign({ userId, role, organizationId: 'org-1' }, process.env.JWT_SECRET!);
}

afterEach(async () => {
  await AuditLog.deleteMany({});
});

// ── helper ─────────────────────────────────────────────────────────────────────

async function seedLogs() {
  const userId = new Types.ObjectId();
  const base = new Date('2026-06-01T12:00:00.000Z');

  await AuditLog.create([
    {
      userId,
      action: 'SHIPMENT_CREATED',
      resource: 'SHIPMENT',
      resourceId: 'ship-1',
      timestamp: new Date(base.getTime() + 1_000),
    },
    {
      userId,
      action: 'USER_INVITED',
      resource: 'USER',
      resourceId: 'user-1',
      timestamp: new Date(base.getTime() + 2_000),
    },
    {
      userId,
      action: 'ANOMALY_DETECTED',
      resource: 'ANOMALY',
      resourceId: 'anomaly-1',
      timestamp: new Date(base.getTime() + 3_000),
    },
    {
      userId,
      action: 'PROOF_UPLOADED',
      resource: 'SHIPMENT',
      resourceId: 'ship-1',
      timestamp: new Date(base.getTime() + 4_000),
    },
    {
      userId,
      action: 'SETTLEMENT_RELEASED',
      resource: 'PAYMENT',
      resourceId: 'pay-1',
      timestamp: new Date(base.getTime() + 5_000),
    },
  ]);

  return { userId, base };
}

// ── auth / access-control tests ────────────────────────────────────────────────

describe('GET /api/activity — auth & role guards', () => {
  it('returns 401 when no bearer token is supplied', async () => {
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(401);
  });

  it('returns 403 for CUSTOMER role', async () => {
    const res = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${makeToken('CUSTOMER')}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 for VIEWER role', async () => {
    const res = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${makeToken('VIEWER')}`);
    expect(res.status).toBe(200);
  });

  it('returns 200 for MANAGER role', async () => {
    const res = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${makeToken('MANAGER')}`);
    expect(res.status).toBe(200);
  });

  it('returns 200 for ADMIN role', async () => {
    const res = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);
    expect(res.status).toBe(200);
  });
});

// ── mixed event types ──────────────────────────────────────────────────────────

describe('GET /api/activity — multiple event types', () => {
  it('returns events from multiple action types in the feed', async () => {
    await seedLogs();

    const res = await request(app)
      .get('/api/activity')
      .query({ limit: 10 })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const actions: string[] = res.body.data.map((e: { action: string }) => e.action);
    const uniqueActions = new Set(actions);

    // Feed must contain at least 3 distinct action types
    expect(uniqueActions.size).toBeGreaterThanOrEqual(3);

    // Must include the newly added action types
    expect(actions).toContain('SHIPMENT_CREATED');
    expect(actions).toContain('USER_INVITED');
    expect(actions).toContain('ANOMALY_DETECTED');
    expect(actions).toContain('PROOF_UPLOADED');
    expect(actions).toContain('SETTLEMENT_RELEASED');
  });

  it('returns standard envelope with meta fields', async () => {
    await seedLogs();

    const res = await request(app)
      .get('/api/activity')
      .query({ limit: 10 })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: expect.any(String),
      data: expect.any(Array),
      meta: expect.objectContaining({
        limit: 10,
        total: expect.any(Number),
        hasMore: expect.any(Boolean),
      }),
    });
  });
});

// ── before-param pagination ────────────────────────────────────────────────────

describe('GET /api/activity — before filter', () => {
  it('before param reduces the result set to events older than the supplied timestamp', async () => {
    const { base } = await seedLogs();

    // Cursor sits after the 3rd event (base + 3s); only events at +1s and +2s are older
    const beforeTs = new Date(base.getTime() + 3_500).toISOString();

    const res = await request(app)
      .get('/api/activity')
      .query({ limit: 10, before: beforeTs })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(200);
    // 3 events inserted before the cursor (base+1s, base+2s, base+3s)
    expect(res.body.data).toHaveLength(3);

    // Every returned timestamp must be strictly less than the cursor
    for (const entry of res.body.data as Array<{ timestamp: string }>) {
      expect(new Date(entry.timestamp).getTime()).toBeLessThan(new Date(beforeTs).getTime());
    }
  });

  it('before param with limit=2 returns hasMore=true and a next before cursor', async () => {
    const { base } = await seedLogs();

    const beforeTs = new Date(base.getTime() + 6_000).toISOString(); // after all 5 events

    const res = await request(app)
      .get('/api/activity')
      .query({ limit: 2, before: beforeTs })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.hasMore).toBe(true);
    expect(res.body.meta.before).toBeTruthy();
  });

  it('walking two pages via before cursor covers all events without overlap', async () => {
    const { base } = await seedLogs();

    const startBefore = new Date(base.getTime() + 6_000).toISOString();

    const page1 = await request(app)
      .get('/api/activity')
      .query({ limit: 2, before: startBefore })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.hasMore).toBe(true);

    const page2 = await request(app)
      .get('/api/activity')
      .query({ limit: 2, before: page1.body.meta.before })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(2);

    // No duplicate IDs across pages
    const ids1 = page1.body.data.map((e: { _id: string }) => e._id);
    const ids2 = page2.body.data.map((e: { _id: string }) => e._id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it('returns empty data and hasMore=false when no events precede the before timestamp', async () => {
    await seedLogs();

    // A timestamp well before all seeded events
    const veryOldBefore = new Date('2020-01-01T00:00:00.000Z').toISOString();

    const res = await request(app)
      .get('/api/activity')
      .query({ limit: 10, before: veryOldBefore })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.hasMore).toBe(false);
    expect(res.body.meta.before).toBeNull();
  });
});

// ── validation ─────────────────────────────────────────────────────────────────

describe('GET /api/activity — validation', () => {
  it('returns 400 for an invalid before value', async () => {
    const res = await request(app)
      .get('/api/activity')
      .query({ before: 'not-a-date' })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(400);
  });

  it('returns 400 for a limit exceeding 100', async () => {
    const res = await request(app)
      .get('/api/activity')
      .query({ limit: 200 })
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(400);
  });
});
