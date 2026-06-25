import { jest, describe, it, expect, beforeEach } from '@jest/globals';

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
  },
  ShipmentStatus: {
    CREATED: 'CREATED',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  },
}));

await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
  Anomaly: { updateMany: jest.fn() },
}));

await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
  Telemetry: { updateMany: jest.fn() },
}));

await jest.unstable_mockModule('../src/services/mockStorageService.js', () => ({
  mockUploadToStorage: jest.fn(),
}));

await jest.unstable_mockModule('../src/modules/analytics/analytics.cache.js', () => ({
  invalidateAnalyticsPerformanceCache: jest.fn(),
}));

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentByShipmentId: jest.fn(),
  updatePaymentStatus: jest.fn(),
}));

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: { findById: jest.fn() },
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  emitStatusUpdate: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
  tokenizeShipment: jest.fn(),
  releaseEscrow: jest.fn(),
}));

const { getShipmentsService } = await import('../src/modules/shipments/shipments.service.js');
const shipmentsModel = await import('../src/modules/shipments/shipments.model.js');
const ShipmentMock = shipmentsModel.Shipment as unknown as { find: jest.Mock; countDocuments: jest.Mock };

describe('Issue #267: No ...filters spread into MongoDB query', () => {
  beforeEach(() => {
    ShipmentMock.find.mockReset();
    ShipmentMock.countDocuments.mockReset();

    const chain = {
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    ShipmentMock.find.mockReturnValue(chain);
    ShipmentMock.countDocuments.mockResolvedValue(0);
  });

  it('passes organizationId explicitly when provided in filters', async () => {
    await getShipmentsService({
      page: 1,
      limit: 20,
      filters: { organizationId: 'org-123' },
    });

    expect(ShipmentMock.find).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-123' })
    );
  });

  it('does not inject unknown filter keys into the MongoDB query', async () => {
    await getShipmentsService({
      page: 1,
      limit: 20,
      filters: {
        organizationId: 'org-123',
        maliciousField: { $gt: '' },
        anotherDangerous: true,
      },
    });

    const query = ShipmentMock.find.mock.calls[0][0];
    expect(query).not.toHaveProperty('maliciousField');
    expect(query).not.toHaveProperty('anotherDangerous');
    expect(query).toHaveProperty('organizationId', 'org-123');
  });

  it('builds an empty query when filters is empty', async () => {
    await getShipmentsService({
      page: 1,
      limit: 20,
      filters: {},
    });

    const query = ShipmentMock.find.mock.calls[0][0];
    expect(query).toEqual({});
  });

  it('still applies status, origin, and destination filters alongside organizationId', async () => {
    await getShipmentsService({
      status: 'CREATED',
      origin: 'Warehouse A',
      destination: 'Store B',
      page: 1,
      limit: 20,
      filters: { organizationId: 'org-456' },
    });

    const query = ShipmentMock.find.mock.calls[0][0];
    expect(query.organizationId).toBe('org-456');
    expect(query.status).toBe('CREATED');
    expect(query.origin).toEqual({ $regex: 'Warehouse A', $options: 'i' });
    expect(query.destination).toEqual({ $regex: 'Store B', $options: 'i' });
  });
});
