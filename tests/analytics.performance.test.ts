import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

describe('GET /api/analytics/performance', () => {
  // Keep deterministic fixtures for mathematical checks.
  const base = new Date('2026-01-10T00:00:00.000Z');
  const startDate = new Date('2026-01-01T00:00:00.000Z');
  const endDate = new Date('2026-01-31T23:59:59.999Z');

  const shipments = [
    {
      _id: 's1',
      status: 'CREATED',
      logisticsId: 'log1',
      createdAt: new Date(base.getTime()),
      milestones: [],
    },
    {
      _id: 's2',
      status: 'DELIVERED',
      logisticsId: 'log1',
      createdAt: new Date(base.getTime() + 1000),
      milestones: [
        {
          name: 'DELIVERED',
          timestamp: new Date(base.getTime() + 1000 + 2000),
        },
      ],
    },
    {
      _id: 's3',
      status: 'IN_TRANSIT',
      logisticsId: 'log2',
      createdAt: new Date(base.getTime() + 3000),
      milestones: [
        // Not delivered yet => shouldn't contribute to averageDeliveryTime.
        { name: 'IN_TRANSIT', timestamp: new Date(base.getTime() + 4000) },
      ],
    },
    {
      _id: 's4_out_of_range',
      status: 'DELIVERED',
      logisticsId: 'log3',
      createdAt: new Date('2025-12-31T00:00:00.000Z'),
      milestones: [
        {
          name: 'DELIVERED',
          timestamp: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
    },
  ];

  let app: Application;

  beforeEach(async () => {
    const mockAggregate = jest.fn(async (pipeline: Array<Record<string, unknown>>) => {
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

      const totalDelayedShipments = windowed.reduce((acc, s) => acc + (s.status !== 'DELIVERED' ? 1 : 0), 0);

      return [
        {
          shipmentsByStatus,
          averageDeliveryTimeByLogisticsId,
          delayedShipments: [{ _id: null, totalDelayed: totalDelayedShipments }],
        },
      ];
    });

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
      return {
        Shipment: {
          aggregate: mockAggregate,
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

    expect(res.body.data.totalDelayedShipments).toBe(2);
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
});

