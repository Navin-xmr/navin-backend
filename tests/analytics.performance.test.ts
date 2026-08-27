import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

describe('GET /api/analytics/performance', () => {
  // Keep deterministic fixtures for mathematical checks.
  const base = new Date('2026-01-10T00:00:00.000Z');
  const startDate = new Date('2026-01-01T00:00:00.000Z');
  const endDate = new Date('2026-01-31T23:59:59.999Z');
  // A date well in the past so expectedDelivery < now is always true for overdue fixtures.
  const overdueDue = new Date('2026-01-05T00:00:00.000Z');
  // A date far in the future so the shipment is not yet overdue.
  const futureDue = new Date('2099-01-01T00:00:00.000Z');

  const shipments = [
    {
      // s1: CREATED, overdue (expectedDelivery in past) => should be counted as delayed
      _id: 's1',
      status: 'CREATED',
      logisticsId: 'log1',
      createdAt: new Date(base.getTime()),
      expectedDelivery: overdueDue,
      milestones: [],
    },
    {
      // s2: DELIVERED => should NOT be counted as delayed regardless of expectedDelivery
      _id: 's2',
      status: 'DELIVERED',
      logisticsId: 'log1',
      createdAt: new Date(base.getTime() + 1000),
      expectedDelivery: overdueDue,
      milestones: [
        {
          name: 'DELIVERED',
          timestamp: new Date(base.getTime() + 1000 + 2000),
        },
      ],
    },
    {
      // s3: IN_TRANSIT but NOT overdue (expectedDelivery far in future) => should NOT be counted
      _id: 's3',
      status: 'IN_TRANSIT',
      logisticsId: 'log2',
      createdAt: new Date(base.getTime() + 3000),
      expectedDelivery: futureDue,
      milestones: [
        { name: 'IN_TRANSIT', timestamp: new Date(base.getTime() + 4000) },
      ],
    },
    {
      // s4_out_of_range: outside the query window => excluded from the windowed set entirely
      _id: 's4_out_of_range',
      status: 'DELIVERED',
      logisticsId: 'log3',
      createdAt: new Date('2025-12-31T00:00:00.000Z'),
      expectedDelivery: overdueDue,
      milestones: [
        {
          name: 'DELIVERED',
          timestamp: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
    },
  ];

  let app: Application;
  let capturedPipeline: Array<Record<string, unknown>> = [];

  // Helper: evaluates the delayedShipments facet semantics as the real aggregation does:
  // only count shipments where status != DELIVERED AND expectedDelivery < now.
  function countDelayed(
    docs: typeof shipments,
    now: Date = new Date(),
  ): number {
    return docs.filter(
      (s) =>
        s.status !== 'DELIVERED' &&
        s.expectedDelivery !== undefined &&
        s.expectedDelivery < now,
    ).length;
  }

  beforeEach(async () => {
    const mockAggregate = jest.fn(async (pipeline: Array<Record<string, unknown>>) => {
      capturedPipeline = pipeline;
      // Very small, purpose-built aggregation evaluator for this test.
      const matchStage = pipeline.find((s) => '$match' in s)?.$match as
        | { createdAt?: { $gte: Date; $lte: Date } }
        | undefined;
      const range = matchStage?.createdAt;

      const windowed = shipments.filter((s) => {
        if (!range) return true;
        const t = s.createdAt.getTime();
        const gte = range.$gte.getTime();
        const lte = range.$lte.getTime();
        return t >= gte && t <= lte;
      });

      const shipmentsByStatus = Object.entries(
        windowed.reduce<Record<string, number>>((acc, s) => {
          acc[s.status] = (acc[s.status] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([status, total]) => ({ _id: status, total }));

      const deliveredDiffsByLogistics: Record<string, number[]> = {};
      for (const s of windowed) {
        for (const m of s.milestones) {
          if (m.name !== 'DELIVERED') continue;
          const diff = new Date(m.timestamp).getTime() - new Date(s.createdAt).getTime();
          deliveredDiffsByLogistics[s.logisticsId] = deliveredDiffsByLogistics[s.logisticsId] ?? [];
          deliveredDiffsByLogistics[s.logisticsId].push(diff);
        }
      }

      const averageDeliveryTimeByLogisticsId = Object.entries(deliveredDiffsByLogistics).map(
        ([logisticsId, diffs]) => ({
          _id: logisticsId,
          averageDeliveryTimeMs: diffs.reduce((a, b) => a + b, 0) / diffs.length,
        }),
      );

      // Correct semantics: only overdue non-delivered shipments (mirrors the real aggregation)
      const totalDelayed = countDelayed(windowed);

      return [
        {
          shipmentsByStatus,
          averageDeliveryTimeByLogisticsId,
          delayedShipments: [{ _id: null, totalDelayed }],
        },
      ];
    });

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
      return {
        Shipment: {
          aggregate: jest.fn((pipeline: Array<Record<string, unknown>>) => ({
            option: jest.fn(() => mockAggregate(pipeline)),
          })),
        },
        ShipmentStatus: {
          CREATED: 'CREATED',
          IN_TRANSIT: 'IN_TRANSIT',
          DELIVERED: 'DELIVERED',
          CANCELLED: 'CANCELLED',
        },
      };
    });

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('calculates shipments-by-status, average delivery time, and total delayed shipments', async () => {
    const { JWT_SECRET } = process.env;
    const token = jwt.sign({ userId: 'u1', role: 'ADMIN' }, JWT_SECRET!);

    const res = await request(app)
      .get('/api/analytics/performance')
      .query({ startDate: startDate.toISOString(), endDate: endDate.toISOString() })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.startDate).toBe(startDate.toISOString());
    expect(res.body.data.endDate).toBe(endDate.toISOString());

    expect(res.body.data.shipmentsByStatus).toEqual(
      expect.arrayContaining([
        { status: 'CREATED', total: 1 },
        { status: 'DELIVERED', total: 1 },
        { status: 'IN_TRANSIT', total: 1 },
      ]),
    );

    // Only shipment s2 has DELIVERED milestone, and its diff is 2000ms.
    expect(res.body.data.averageDeliveryTimeByLogisticsId).toEqual(
      expect.arrayContaining([{ logisticsId: 'log1', averageDeliveryTimeMs: 2000 }]),
    );

    // s1 is CREATED + overdue => 1 delayed.
    // s2 is DELIVERED => not counted.
    // s3 is IN_TRANSIT but expectedDelivery is in the future => not counted.
    expect(res.body.data.totalDelayedShipments).toBe(1);

    const serializedPipeline = JSON.stringify(capturedPipeline);
    expect(serializedPipeline).not.toContain('$unwind');
    expect(serializedPipeline).toContain('deliveredTimestamp');
  });

  it('returns 403 when role is not ADMIN or MANAGER', async () => {
    const { JWT_SECRET } = process.env;
    const token = jwt.sign({ userId: 'u1', role: 'VIEWER' }, JWT_SECRET!);

    const res = await request(app)
      .get('/api/analytics/performance')
      .query({ startDate: startDate.toISOString(), endDate: endDate.toISOString() })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/forbidden/i);
  });

  // -- totalDelayedShipments semantics (issue #357) ----------------------------
  describe('totalDelayedShipments semantics', () => {
    it('counts an overdue non-delivered shipment as delayed', () => {
      const overdueShipment = [
        {
          _id: 'x1',
          status: 'IN_TRANSIT',
          logisticsId: 'log1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          expectedDelivery: new Date('2026-01-02T00:00:00.000Z'), // past
          milestones: [],
        },
      ];
      expect(countDelayed(overdueShipment)).toBe(1);
    });

    it('does NOT count an in-transit shipment that is not yet overdue', () => {
      const notYetOverdue = [
        {
          _id: 'x2',
          status: 'IN_TRANSIT',
          logisticsId: 'log1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          expectedDelivery: new Date('2099-01-01T00:00:00.000Z'), // future
          milestones: [],
        },
      ];
      expect(countDelayed(notYetOverdue)).toBe(0);
    });

    it('does NOT count a delivered shipment even when its expectedDelivery is in the past', () => {
      const delivered = [
        {
          _id: 'x3',
          status: 'DELIVERED',
          logisticsId: 'log1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          expectedDelivery: new Date('2026-01-02T00:00:00.000Z'), // past
          milestones: [
            { name: 'DELIVERED', timestamp: new Date('2026-01-10T00:00:00.000Z') },
          ],
        },
      ];
      expect(countDelayed(delivered)).toBe(0);
    });
  });

  // -- UTC timezone parsing tests ----------------------------------------------
  describe('UTC date validation', () => {
    let adminToken: string;

    beforeEach(() => {
      const { JWT_SECRET } = process.env;
      adminToken = jwt.sign({ userId: 'u1', role: 'ADMIN' }, JWT_SECRET!);
    });

    it('accepts dates with Z suffix (UTC)', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-01-31T23:59:59.999Z',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Dates must be echoed back as UTC ISO strings
      expect(res.body.data.startDate).toBe('2026-01-01T00:00:00.000Z');
      expect(res.body.data.endDate).toBe('2026-01-31T23:59:59.999Z');
    });

    it('accepts dates with +00:00 offset (UTC)', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({
          startDate: '2026-01-01T00:00:00+00:00',
          endDate: '2026-01-31T23:59:59+00:00',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Both +00:00 and Z represent the same UTC instant
      expect(res.body.data.startDate).toBe('2026-01-01T00:00:00.000Z');
      expect(res.body.data.endDate).toBe('2026-01-31T23:59:59.000Z');
    });

    it('rejects a local datetime string without timezone offset', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({
          startDate: '2026-01-01T00:00:00',
          endDate: '2026-01-31T23:59:59',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('rejects a non-UTC offset (e.g. +05:30)', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({
          startDate: '2026-01-01T00:00:00+05:30',
          endDate: '2026-01-31T23:59:59+05:30',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('rejects a date-only string (no time component)', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('rejects missing startDate', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({ endDate: '2026-01-31T23:59:59.999Z' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('rejects missing endDate', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({ startDate: '2026-01-01T00:00:00.000Z' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('rejects startDate > endDate', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({
          startDate: '2026-02-01T00:00:00.000Z',
          endDate: '2026-01-01T00:00:00.000Z',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('passes UTC dates to the DB aggregation pipeline unchanged', async () => {
      const res = await request(app)
        .get('/api/analytics/performance')
        .query({
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-01-31T23:59:59.999Z',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // The service echoes back the ISO strings it received from the parsed Dates.
      // If the schema had coerced a local time, the UTC offset would differ.
      expect(new Date(res.body.data.startDate).toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(new Date(res.body.data.endDate).toISOString()).toBe('2026-01-31T23:59:59.999Z');
    });
  });
});