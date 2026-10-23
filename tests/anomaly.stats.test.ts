import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { redisMock } from './fixtures/factories.js';

/** @see issue-#297 */

const redisStore = new Map<string, string>();
await jest.unstable_mockModule('../src/infra/redis/connection.js', () => redisMock(redisStore));
// ─── Issue #297 — Anomaly stats ──────────────────────────────────────────────

describe('#297 getAnomalyStatsService', () => {
  // Mirrors the real $facet output of getAnomalyStatsService: each key is an
  // array of { count } (or { _id, count } for the grouped facets).
  const facetResult = [{
    totalActive: [{ count: 5 }],
    totalAll: [{ count: 10 }],
    resolved: [{ count: 4 }],
    bySeverity: [{ _id: 'HIGH', count: 3 }, { _id: 'LOW', count: 2 }],
    byType: [{ _id: 'TEMPERATURE_EXCEEDED', count: 5 }],
  }];

  const mockAggregate = jest.fn(async () => facetResult);

  beforeEach(async () => {
    jest.resetModules();
    redisStore.clear();
    mockAggregate.mockClear();

    await jest.unstable_mockModule('../src/infra/redis/connection.js', () => redisMock(redisStore));
    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
      Anomaly: { aggregate: mockAggregate, findByIdAndUpdate: jest.fn(), find: jest.fn(), create: jest.fn() },
    }));
  });

  it('returns correct aggregated stats', async () => {
    const { getAnomalyStatsService } = await import('../src/modules/anomaly/anomaly.service.js');
    const stats = await getAnomalyStatsService();
    expect(stats.totalActive).toBe(5);
    expect(stats.bySeverity).toEqual({ CRITICAL: 0, HIGH: 3, MEDIUM: 0, LOW: 2 });
    expect(stats.byType['TEMPERATURE_EXCEEDED']).toBe(5);
    expect(stats.resolutionRate).toBeCloseTo(0.4);
  });

  it('returns cached result on second call without hitting DB again', async () => {
    const { getAnomalyStatsService } = await import('../src/modules/anomaly/anomaly.service.js');
    await getAnomalyStatsService();
    // Warm the cache manually for the second call (redis get already set via set)
    await getAnomalyStatsService();
    // aggregate should only have been called once
    expect(mockAggregate).toHaveBeenCalledTimes(1);
  });

  it('returns zeros for empty collection', async () => {
    mockAggregate.mockResolvedValueOnce([{
      totalActive: [],
      totalAll: [],
      resolved: [],
      bySeverity: [],
      byType: [],
    }] as any);
    const { getAnomalyStatsService } = await import('../src/modules/anomaly/anomaly.service.js');
    const stats = await getAnomalyStatsService('org-empty');
    expect(stats.totalActive).toBe(0);
    expect(stats.resolutionRate).toBe(0);
  });
});
