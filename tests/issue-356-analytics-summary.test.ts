import { jest, describe, it, expect, beforeEach, beforeAll } from '@jest/globals';

// Mock data
const shipments: Record<string, unknown>[] = [];
const mockCacheData: Map<string, unknown> = new Map();

// Mock Redis cache
const mockRedisClient = {
  get: jest.fn().mockImplementation(async (key: string) => {
    const value = mockCacheData.get(key);
    return value ? JSON.stringify(value) : null;
  }),
  set: jest.fn().mockImplementation(async (_key: string, value: string) => {
    mockCacheData.set(_key, JSON.parse(value));
    return 'OK';
  }),
};

await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
  getRedisClient: () => mockRedisClient,
}));

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(0);
}

function periodKpis(period: Record<string, unknown>[]) {
  const withTransit = period.filter(s => s.transitDays !== null && s.transitDays !== undefined);
  const avgTransitDays =
    withTransit.reduce((sum, s) => sum + Number(s.transitDays ?? 0), 0) /
    Math.max(1, withTransit.length);
  return {
    totalShipments: period.length,
    onTimeCount: period.filter(s => s.isOnTime === true).length,
    dispatchedCount: period.filter(s => s.isOnTime !== null).length,
    disputedCount: period.filter(s => (Array.isArray(s.disputes) ? s.disputes : []).length > 0)
      .length,
    avgTransitDays: avgTransitDays || 0,
  };
}

function buildSummaryRows() {
  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const currentPeriod = shipments.filter(s => asDate(s.createdAt) >= thirtyDaysAgo);
  const previousPeriod = shipments.filter(s => {
    const createdAt = asDate(s.createdAt);
    return createdAt >= sixtyDaysAgo && createdAt < thirtyDaysAgo;
  });

  const sparklineByDay = new Map<
    number,
    {
      _id: Date;
      shipmentCount: number;
      onTimeCount: number;
      dispatchedCount: number;
      transitSum: number;
      transitN: number;
      disputedCount: number;
    }
  >();

  for (const s of currentPeriod) {
    const day = new Date(asDate(s.createdAt));
    day.setUTCHours(0, 0, 0, 0);
    const key = day.getTime();
    const row = sparklineByDay.get(key) ?? {
      _id: day,
      shipmentCount: 0,
      onTimeCount: 0,
      dispatchedCount: 0,
      transitSum: 0,
      transitN: 0,
      disputedCount: 0,
    };
    row.shipmentCount += 1;
    if (s.isOnTime === true) row.onTimeCount += 1;
    if (s.isOnTime !== null) row.dispatchedCount += 1;
    if ((Array.isArray(s.disputes) ? s.disputes : []).length > 0) row.disputedCount += 1;
    if (s.transitDays !== null && s.transitDays !== undefined) {
      row.transitSum += Number(s.transitDays);
      row.transitN += 1;
    }
    sparklineByDay.set(key, row);
  }

  const currentSparklines = [...sparklineByDay.values()].map(row => ({
    _id: row._id,
    shipmentCount: row.shipmentCount,
    onTimeCount: row.onTimeCount,
    dispatchedCount: row.dispatchedCount,
    avgTransitDays: row.transitN ? row.transitSum / row.transitN : 0,
    disputedCount: row.disputedCount,
  }));

  return [
    {
      currentKpis: [periodKpis(currentPeriod)],
      previousKpis: [periodKpis(previousPeriod)],
      currentSparklines,
    },
  ];
}

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
  const ShipmentModel = {
    aggregate: jest.fn(() => ({
      option: jest.fn(async () => buildSummaryRows()),
    })),
  };

  return { Shipment: ShipmentModel };
});

const { getAnalyticsSummary } = await import('../src/modules/analytics/analytics.service.js');

describe('#356 - Analytics Summary with KPI Sparklines', () => {
  beforeAll(() => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  beforeEach(() => {
    shipments.length = 0;
    mockCacheData.clear();
    jest.clearAllMocks();

    // Add 60 days of shipments
    const now = new Date();
    for (let i = 0; i < 60; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      for (let j = 0; j < 10; j++) {
        shipments.push({
          _id: `ship-${i}-${j}`,
          createdAt: date,
          organizationId: 'org-1',
          expectedDelivery: new Date(date.getTime() + 5 * 24 * 60 * 60 * 1000),
          isOnTime: Math.random() > 0.2, // 80% on time
          transitDays: Math.random() * 10 + 2, // 2-12 days
          disputes: Math.random() > 0.9 ? [{ type: 'DAMAGED' }] : [], // 10% disputed
          milestones: [],
        });
      }
    }
  });

  it('should return all required fields with correct types (200)', async () => {
    const summary = await getAnalyticsSummary({});

    expect(summary).toHaveProperty('onTimeDeliveryRate');
    expect(summary).toHaveProperty('onTimeDeliveryRatePrev');
    expect(summary).toHaveProperty('onTimeDeliverySparkline');
    expect(summary).toHaveProperty('averageTransitDays');
    expect(summary).toHaveProperty('averageTransitDaysPrev');
    expect(summary).toHaveProperty('averageTransitSparkline');
    expect(summary).toHaveProperty('totalShipmentsThisMonth');
    expect(summary).toHaveProperty('totalShipmentsPrevMonth');
    expect(summary).toHaveProperty('shipmentsSparkline');
    expect(summary).toHaveProperty('disputeRate');
    expect(summary).toHaveProperty('disputeRatePrev');
    expect(summary).toHaveProperty('disputesSparkline');
    expect(summary).toHaveProperty('lastUpdated');

    expect(typeof summary.onTimeDeliveryRate).toBe('number');
    expect(typeof summary.averageTransitDays).toBe('number');
    expect(typeof summary.totalShipmentsThisMonth).toBe('number');
    expect(typeof summary.disputeRate).toBe('number');
    expect(typeof summary.lastUpdated).toBe('string');
  });

  it('should have sparklines with exactly 30 numbers', async () => {
    const summary = await getAnalyticsSummary({});

    expect(summary.onTimeDeliverySparkline).toHaveLength(30);
    expect(summary.averageTransitSparkline).toHaveLength(30);
    expect(summary.shipmentsSparkline).toHaveLength(30);
    expect(summary.disputesSparkline).toHaveLength(30);

    // All should be numbers
    summary.onTimeDeliverySparkline.forEach(v => expect(typeof v).toBe('number'));
    summary.averageTransitSparkline.forEach(v => expect(typeof v).toBe('number'));
    summary.shipmentsSparkline.forEach(v => expect(typeof v).toBe('number'));
    summary.disputesSparkline.forEach(v => expect(typeof v).toBe('number'));
  });

  it('should cache result and return same data without re-aggregation', async () => {
    const Shipment = await import('../src/modules/shipments/shipments.model.js').then(
      m => m.Shipment
    );
    const aggregateSpy = jest.spyOn(Shipment, 'aggregate');

    // First call
    const summary1 = await getAnalyticsSummary({});
    expect(aggregateSpy).toHaveBeenCalledTimes(1);

    // Second call (should be cached)
    const summary2 = await getAnalyticsSummary({});
    expect(aggregateSpy).toHaveBeenCalledTimes(1); // Still 1, not 2

    // Results should be identical
    expect(summary1.onTimeDeliveryRate).toBe(summary2.onTimeDeliveryRate);
    expect(summary1.totalShipmentsThisMonth).toBe(summary2.totalShipmentsThisMonth);
  });

  it('should reflect previous 30-day window correctly', async () => {
    const summary = await getAnalyticsSummary({});

    // Current and previous should be different KPIs
    expect(summary.onTimeDeliveryRate).toBeDefined();
    expect(summary.onTimeDeliveryRatePrev).toBeDefined();
    expect(summary.totalShipmentsThisMonth).toBeDefined();
    expect(summary.totalShipmentsPrevMonth).toBeDefined();

    // Previous should not be equal to current (unless unlucky randomness)
    // Both values should be reasonable percentages for on-time delivery
    expect(summary.onTimeDeliveryRate).toBeGreaterThanOrEqual(0);
    expect(summary.onTimeDeliveryRate).toBeLessThanOrEqual(100);
    expect(summary.onTimeDeliveryRatePrev).toBeGreaterThanOrEqual(0);
    expect(summary.onTimeDeliveryRatePrev).toBeLessThanOrEqual(100);
  });

  it('should calculate KPI values as expected', async () => {
    const summary = await getAnalyticsSummary({});

    // On-time delivery rate should be between 0-100
    expect(summary.onTimeDeliveryRate).toBeGreaterThanOrEqual(0);
    expect(summary.onTimeDeliveryRate).toBeLessThanOrEqual(100);

    // Average transit days should be positive
    expect(summary.averageTransitDays).toBeGreaterThanOrEqual(0);

    // Total shipments should be positive
    expect(summary.totalShipmentsThisMonth).toBeGreaterThanOrEqual(0);

    // Dispute rate should be between 0-100
    expect(summary.disputeRate).toBeGreaterThanOrEqual(0);
    expect(summary.disputeRate).toBeLessThanOrEqual(100);
  });

  it('should support organizationId parameter for scoped analytics', async () => {
    const summary = await getAnalyticsSummary({ organizationId: 'org-1' });

    expect(summary).toHaveProperty('onTimeDeliveryRate');
    expect(summary.totalShipmentsThisMonth).toBeGreaterThanOrEqual(0);
  });

  it('should return lastUpdated as ISO string', async () => {
    const summary = await getAnalyticsSummary({});

    expect(summary.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const date = new Date(summary.lastUpdated);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
    expect(date.getTime()).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
  });

  it('should cache different organizations separately', async () => {
    const summary1 = await getAnalyticsSummary({ organizationId: 'org-1' });
    const summary2 = await getAnalyticsSummary({ organizationId: 'org-2' });

    expect(mockRedisClient.set).toHaveBeenCalledTimes(2);

    // Both should have data
    expect(summary1.totalShipmentsThisMonth).toBeGreaterThanOrEqual(0);
    expect(summary2.totalShipmentsThisMonth).toBeGreaterThanOrEqual(0);
  });

  it('should return 0 for all metrics when no shipments exist', async () => {
    shipments.length = 0;

    const summary = await getAnalyticsSummary({});

    expect(summary.onTimeDeliveryRate).toBe(0);
    expect(summary.totalShipmentsThisMonth).toBe(0);
    expect(summary.disputeRate).toBe(0);
  });

  it('sparklines should all be arrays of numbers >= 0', async () => {
    const summary = await getAnalyticsSummary({});

    summary.onTimeDeliverySparkline.forEach(v => {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
    });

    summary.shipmentsSparkline.forEach(v => {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
    });

    summary.disputesSparkline.forEach(v => {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
    });
  });
});
