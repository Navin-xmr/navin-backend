/**
 * Tests for #374: GET /api/settlements/summary?period=week|month|quarter
 *
 * Covers:
 *   - 200 for each valid period (week, month, quarter)
 *   - sparkline array length matches period days (7, 30, 90)
 *   - 400 for invalid period value
 *   - Redis cache: second call served from cache
 */
import { jest, describe, it, beforeEach, expect } from '@jest/globals';

// ── Redis cache mock ─────────────────────────────────────────────────────────
const cacheStore = new Map<string, string>();
const redisGet = jest.fn(async (key: string) => cacheStore.get(key) ?? null);
const redisSet = jest.fn(async (key: string, value: string) => {
  cacheStore.set(key, value);
  return 'OK';
});

await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
  getRedisClient: jest.fn(() => ({ get: redisGet, set: redisSet })),
  getRedisConnection: jest.fn(),
  disconnectRedis: jest.fn(),
}));

// ── Repo mock ────────────────────────────────────────────────────────────────
const aggregateSettlementSummaryMock = jest.fn<
  (orgId: string, since: Date) => Promise<unknown>
>();
const buildSettlementSparklineMock = jest.fn<
  (orgId: string, since: Date, days: number) => Promise<number[]>
>();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  aggregateSettlementSummary: aggregateSettlementSummaryMock,
  buildSettlementSparkline: buildSettlementSparklineMock,
  getPaymentsByOrganization: jest.fn(),
  getPaymentById: jest.fn(),
  createPayment: jest.fn(),
  updatePaymentStatus: jest.fn(),
  getPaymentByShipmentId: jest.fn(),
  deletePayment: jest.fn(),
  disputePayment: jest.fn(),
}));

const { getSettlementSummaryService } = await import(
  '../src/modules/payments/settlements.summary.service.js'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTotals() {
  return { totalReleased: 1000, totalInEscrow: 500, totalPending: 200 };
}

function makeSparkline(days: number): number[] {
  return Array.from({ length: days }, (_, i) => i * 10);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getSettlementSummaryService', () => {
  beforeEach(() => {
    aggregateSettlementSummaryMock.mockReset();
    buildSettlementSparklineMock.mockReset();
    redisGet.mockReset();
    redisSet.mockReset();
    cacheStore.clear();

    // Default: cache miss
    redisGet.mockImplementation(async (key: string) => cacheStore.get(key) ?? null);
    redisSet.mockImplementation(async (key: string, value: string) => {
      cacheStore.set(key, value);
      return 'OK';
    });
  });

  it('200 — week: returns correct shape with sparkline length 7', async () => {
    aggregateSettlementSummaryMock.mockResolvedValue(makeTotals());
    buildSettlementSparklineMock.mockResolvedValue(makeSparkline(7));

    const result = await getSettlementSummaryService('org-1', 'week');

    expect(result.totalReleased).toBe(1000);
    expect(result.totalInEscrow).toBe(500);
    expect(result.totalPending).toBe(200);
    expect(result.sparkline).toHaveLength(7);
    expect(result.period).toBe('week');
  });

  it('200 — month: sparkline length is 30', async () => {
    aggregateSettlementSummaryMock.mockResolvedValue(makeTotals());
    buildSettlementSparklineMock.mockResolvedValue(makeSparkline(30));

    const result = await getSettlementSummaryService('org-1', 'month');

    expect(result.sparkline).toHaveLength(30);
    expect(result.period).toBe('month');
  });

  it('200 — quarter: sparkline length is 90', async () => {
    aggregateSettlementSummaryMock.mockResolvedValue(makeTotals());
    buildSettlementSparklineMock.mockResolvedValue(makeSparkline(90));

    const result = await getSettlementSummaryService('org-1', 'quarter');

    expect(result.sparkline).toHaveLength(90);
    expect(result.period).toBe('quarter');
  });

  it('400 — invalid period throws AppError with ERR_BAD_REQUEST', async () => {
    await expect(getSettlementSummaryService('org-1', 'yearly')).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_BAD_REQUEST',
    });

    // Repo should not be called for invalid period
    expect(aggregateSettlementSummaryMock).not.toHaveBeenCalled();
  });

  it('second call for same org+period is served from Redis cache without hitting repo', async () => {
    aggregateSettlementSummaryMock.mockResolvedValue(makeTotals());
    buildSettlementSparklineMock.mockResolvedValue(makeSparkline(7));

    // First call — cold cache
    const first = await getSettlementSummaryService('org-cached', 'week');

    // Second call — should hit cache
    const second = await getSettlementSummaryService('org-cached', 'week');

    expect(first).toEqual(second);
    // Repo must only have been called once
    expect(aggregateSettlementSummaryMock).toHaveBeenCalledTimes(1);
    expect(redisSet).toHaveBeenCalledTimes(1);
    expect(redisGet).toHaveBeenCalledTimes(2);
  });

  it('repo receives correct `since` date aligned to start of day UTC', async () => {
    aggregateSettlementSummaryMock.mockResolvedValue(makeTotals());
    buildSettlementSparklineMock.mockResolvedValue(makeSparkline(7));

    await getSettlementSummaryService('org-2', 'week');

    const [, sinceDateArg] = aggregateSettlementSummaryMock.mock.calls[0] as [string, Date];
    // since must be midnight UTC
    expect(sinceDateArg.getUTCHours()).toBe(0);
    expect(sinceDateArg.getUTCMinutes()).toBe(0);
    expect(sinceDateArg.getUTCSeconds()).toBe(0);
  });

  it('sparkline repo call receives correct days count', async () => {
    aggregateSettlementSummaryMock.mockResolvedValue(makeTotals());
    buildSettlementSparklineMock.mockResolvedValue(makeSparkline(30));

    await getSettlementSummaryService('org-3', 'month');

    const [, , daysArg] = buildSettlementSparklineMock.mock.calls[0] as [string, Date, number];
    expect(daysArg).toBe(30);
  });
});
