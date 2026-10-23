import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { redisMock } from './fixtures/factories.js';

/** @see issue-#296 */

const redisStore = new Map<string, string>();
await jest.unstable_mockModule('../src/infra/redis/connection.js', () => redisMock(redisStore));
// ─── Issue #296 — Shipment export ────────────────────────────────────────────

describe('#296 exportShipmentsService + shipmentsToCSV', () => {
  const shipments = [
    { _id: 's1', trackingNumber: 'NVN-001', origin: 'Lagos', destination: 'Abuja', status: 'CREATED', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
    { _id: 's2', trackingNumber: 'NVN-002', origin: 'Kano', destination: 'PH', status: 'DELIVERED', createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02') },
  ];

  const mockLimit = jest.fn(() => ({ lean: jest.fn(async () => shipments) }));
  const mockSort = jest.fn(() => ({ limit: mockLimit }));
  const mockFind = jest.fn(() => ({ sort: mockSort }));
  const mockCount = jest.fn(async () => 2);

  beforeEach(async () => {
    jest.resetModules();
    mockFind.mockClear();
    mockSort.mockClear();
    mockLimit.mockClear();
    mockCount.mockClear();

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        find: mockFind,
        countDocuments: mockCount,
      },
      ShipmentStatus: { CREATED: 'CREATED', DELIVERED: 'DELIVERED' },
    }));

    await jest.unstable_mockModule('../src/modules/ledger/ledger.service.js', () => ({
      createLedgerBlockService: jest.fn(),
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
