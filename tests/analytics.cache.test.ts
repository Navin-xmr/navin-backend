import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Application } from 'express';

describe('analytics redis cache', () => {
  let app: Application;

  const cache = new Map<string, string>();
  const redisGet = jest.fn(async (key: string) => cache.get(key) ?? null);
  const redisSet = jest.fn(async (key: string, value: string) => {
    cache.set(key, value);
    return 'OK';
  });
  const redisScan = jest.fn(async () => ['0', [] as string[]]);
  const redisDel = jest.fn(async () => 0);

  const aggregateExecutions = { count: 0 };

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    cache.clear();
    aggregateExecutions.count = 0;

    await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
      getRedisClient: jest.fn(() => ({
        get: redisGet,
        set: redisSet,
        scan: redisScan,
        del: redisDel,
      })),
      redisConnection: {},
    }));

    const mockAggregate = jest.fn((pipeline: unknown) => ({
      option: jest.fn(async () => {
        aggregateExecutions.count += 1;
        return [
          {
            shipmentsByStatus: [{ _id: 'DELIVERED', total: 4 }],
            averageDeliveryTimeByLogisticsId: [{ _id: 'log-1', averageDeliveryTimeMs: 2000 }],
            delayedShipments: [{ totalDelayed: 1 }],
          },
        ];
      }),
    }));

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        aggregate: mockAggregate,
      },
      ShipmentStatus: {
        CREATED: 'CREATED',
        IN_TRANSIT: 'IN_TRANSIT',
        DELIVERED: 'DELIVERED',
        CANCELLED: 'CANCELLED',
      },
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('serves second performance request from redis cache without hitting aggregation again', async () => {
    const token = jwt.sign({ userId: 'u1', role: 'ADMIN' }, process.env.JWT_SECRET!);
    const query = {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T23:59:59.999Z',
    };

    const first = await request(app)
      .get('/api/analytics/performance')
      .query(query)
      .set('Authorization', `Bearer ${token}`);

    const second = await request(app)
      .get('/api/analytics/performance')
      .query(query)
      .set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(aggregateExecutions.count).toBe(1);
    expect(redisSet).toHaveBeenCalledTimes(1);
    expect(redisGet).toHaveBeenCalledTimes(2);
  });
});
