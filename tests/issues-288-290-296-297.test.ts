import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';

// ─── shared mocks ────────────────────────────────────────────────────────────

const redisStore = new Map<string, string>();
const redisMock = {
  get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
  set: jest.fn(async (k: string, v: string, ..._rest: unknown[]) => { redisStore.set(k, v); return 'OK'; }),
  quit: jest.fn(async () => {}),
};

await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
  getRedisClient: () => redisMock,
  getRedisConnection: () => redisMock,
  disconnectRedis: jest.fn(async () => {}),
}));

// ─── Issue #288 — Anomaly resolution notes ───────────────────────────────────

describe('#288 resolveAnomalyService — resolution notes', () => {
  const mockAnomaly = {
    _id: 'anom-1',
    shipmentId: 'ship-1',
    type: 'TEMPERATURE_EXCEEDED',
    severity: 'HIGH',
    message: 'Too hot',
    resolved: true,
    resolvedAt: new Date(),
    resolvedBy: 'user-42',
    resolutionNote: 'False alarm',
  };

  const findByIdAndUpdate = jest.fn(() => ({ lean: jest.fn(async () => mockAnomaly) }));

  beforeEach(async () => {
    jest.resetModules();
    findByIdAndUpdate.mockClear();
    await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
      getRedisClient: () => redisMock,
      getRedisConnection: () => redisMock,
      disconnectRedis: jest.fn(async () => {}),
    }));
    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
      Anomaly: { findByIdAndUpdate },
    }));
  });

  it('sets resolved, resolvedAt, resolvedBy and resolutionNote', async () => {
    const { resolveAnomalyService } = await import('../src/modules/anomaly/anomaly.service.js');
    const result = await resolveAnomalyService('anom-1', 'user-42', 'False alarm');
    const [, update] = findByIdAndUpdate.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(update.resolved).toBe(true);
    expect(update.resolvedBy).toBe('user-42');
    expect(update.resolutionNote).toBe('False alarm');
    expect(update.resolvedAt).toBeInstanceOf(Date);
    expect(result).toEqual(mockAnomaly);
  });

  it('works without a note (backward-compatible)', async () => {
    const { resolveAnomalyService } = await import('../src/modules/anomaly/anomaly.service.js');
    await resolveAnomalyService('anom-1', 'user-42');
    const [, update] = findByIdAndUpdate.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(update.resolutionNote).toBeUndefined();
    expect(update.resolvedBy).toBe('user-42');
  });

  it('throws when anomaly not found', async () => {
    findByIdAndUpdate.mockReturnValueOnce({ lean: jest.fn(async () => null) } as any);
    const { resolveAnomalyService } = await import('../src/modules/anomaly/anomaly.service.js');
    await expect(resolveAnomalyService('bad-id', 'user-1')).rejects.toThrow('Anomaly not found');
  });
});

// ─── Issue #290 — Token refresh ──────────────────────────────────────────────

describe('#290 refreshToken service', () => {
  const JWT_SECRET = process.env.JWT_SECRET!;

  const mockUser = { _id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN', deletedAt: null };
  const mockFindById = jest.fn(async () => ({ ...mockUser, lean: () => mockUser }));

  beforeEach(async () => {
    jest.resetModules();
    redisStore.clear();
    mockFindById.mockClear();

    await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
      getRedisClient: () => redisMock,
      getRedisConnection: () => redisMock,
      disconnectRedis: jest.fn(async () => {}),
    }));
    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: { findOne: jest.fn(), findById: jest.fn(() => ({ lean: jest.fn(async () => mockUser) })) },
      OrganizationModel: { findById: jest.fn() },
      UserRole: { ADMIN: 'ADMIN', VIEWER: 'VIEWER' },
      OrganizationType: {},
    }));
  });

  it('issues a new token and blocklists the old jti', async () => {
    const { refreshToken } = await import('../src/modules/auth/auth.service.js');
    const oldToken = jwt.sign({ userId: 'u1', role: 'ADMIN', jti: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }, JWT_SECRET, { expiresIn: '7d' });
    const result = await refreshToken(oldToken);
    expect(result.token).toBeTruthy();
    expect(result.expiresIn).toBe(7 * 24 * 60 * 60);
    // old jti should be blocklisted
    const blocked = [...redisStore.keys()].some(k => k.includes('aaaaaaaa'));
    expect(blocked).toBe(true);
  });

  it('returns 401 when token is already blocklisted', async () => {
    const { refreshToken } = await import('../src/modules/auth/auth.service.js');
    const jti = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const token = jwt.sign({ userId: 'u1', role: 'ADMIN', jti }, JWT_SECRET, { expiresIn: '7d' });
    redisStore.set(`blocklist:uuid:${jti}`, '1');
    await expect(refreshToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 401 for completely invalid token', async () => {
    const { refreshToken } = await import('../src/modules/auth/auth.service.js');
    await expect(refreshToken('not.a.token')).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ─── Issue #296 — Shipment export ────────────────────────────────────────────

describe('#296 exportShipmentsService + shipmentsToCSV', () => {
  const shipments = [
    { _id: 's1', trackingNumber: 'NVN-001', origin: 'Lagos', destination: 'Abuja', status: 'CREATED', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
    { _id: 's2', trackingNumber: 'NVN-002', origin: 'Kano', destination: 'PH', status: 'DELIVERED', createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02') },
  ];

  const mockSort = jest.fn(() => ({ lean: jest.fn(async () => shipments) }));
  const mockFind = jest.fn(() => ({ sort: mockSort }));
  const mockCount = jest.fn(async () => 2);

  beforeEach(async () => {
    jest.resetModules();
    mockFind.mockClear();
    mockCount.mockClear();

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        find: mockFind,
        countDocuments: mockCount,
      },
      ShipmentStatus: { CREATED: 'CREATED', DELIVERED: 'DELIVERED' },
    }));
  });

  it('returns records when count ≤ 10,000', async () => {
    const { exportShipmentsService } = await import('../src/modules/shipments/shipments.service.js');
    const result = await exportShipmentsService({});
    expect(result).toHaveLength(2);
  });

  it('throws 400 when count > 10,000', async () => {
    mockCount.mockResolvedValueOnce(10_001 as any);
    const { exportShipmentsService } = await import('../src/modules/shipments/shipments.service.js');
    await expect(exportShipmentsService({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('shipmentsToCSV produces correct header and row count', async () => {
    const { shipmentsToCSV } = await import('../src/modules/shipments/shipments.service.js');
    const csv = shipmentsToCSV(shipments as any);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('trackingNumber');
    expect(lines).toHaveLength(3); // header + 2 rows
  });
});

// ─── Issue #297 — Anomaly stats ──────────────────────────────────────────────

describe('#297 getAnomalyStatsService', () => {
  const facetResult = [{
    totalActive: [{ count: 5 }],
    bySeverity: [{ _id: 'HIGH', count: 3 }, { _id: 'LOW', count: 2 }],
    byType: [{ _id: 'TEMPERATURE_EXCEEDED', count: 5 }],
    totals: [{ total: 10, resolved: 4 }],
  }];

  const mockAggregate = jest.fn(async () => facetResult);

  beforeEach(async () => {
    jest.resetModules();
    redisStore.clear();
    mockAggregate.mockClear();

    await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
      getRedisClient: () => redisMock,
      getRedisConnection: () => redisMock,
      disconnectRedis: jest.fn(async () => {}),
    }));
    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
      Anomaly: { aggregate: mockAggregate, findByIdAndUpdate: jest.fn(), find: jest.fn(), create: jest.fn() },
    }));
  });

  it('returns correct aggregated stats', async () => {
    const { getAnomalyStatsService } = await import('../src/modules/anomaly/anomaly.service.js');
    const stats = await getAnomalyStatsService();
    expect(stats.totalActive).toBe(5);
    expect(stats.bySeverity.high).toBe(3);
    expect(stats.bySeverity.low).toBe(2);
    expect(stats.byType['TEMPERATURE_EXCEEDED']).toBe(5);
    expect(stats.resolutionRate).toBeCloseTo(0.4);
  });

  it('returns cached result on second call without hitting DB again', async () => {
    const { getAnomalyStatsService } = await import('../src/modules/anomaly/anomaly.service.js');
    await getAnomalyStatsService();
    // Warm the cache manually for the second call (redisMock.get already set via set)
    await getAnomalyStatsService();
    // aggregate should only have been called once
    expect(mockAggregate).toHaveBeenCalledTimes(1);
  });

  it('returns zeros for empty collection', async () => {
    mockAggregate.mockResolvedValueOnce([{
      totalActive: [],
      bySeverity: [],
      byType: [],
      totals: [],
    }] as any);
    const { getAnomalyStatsService } = await import('../src/modules/anomaly/anomaly.service.js');
    const stats = await getAnomalyStatsService('org-empty');
    expect(stats.totalActive).toBe(0);
    expect(stats.resolutionRate).toBe(0);
  });
});
