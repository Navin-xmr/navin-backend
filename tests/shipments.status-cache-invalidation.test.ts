import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('shipment status cache invalidation', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('invalidates analytics cache when shipment status changes', async () => {
    const save = jest.fn(async () => undefined);
    const shipmentDoc = {
      _id: 'shipment-1',
      status: 'CREATED',
      milestones: [] as Array<Record<string, unknown>>,
      updatedAt: new Date(),
      save,
    };

    const invalidateAnalyticsPerformanceCache = jest.fn(async () => undefined);
    const emitStatusUpdate = jest.fn();

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        findById: jest.fn(async () => shipmentDoc),
        find: jest.fn(),
      },
      ShipmentStatus: {
        CREATED: 'CREATED',
        IN_TRANSIT: 'IN_TRANSIT',
        DELIVERED: 'DELIVERED',
        CANCELLED: 'CANCELLED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findById: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      emitStatusUpdate,
    }));

    await jest.unstable_mockModule('../src/modules/analytics/analytics.cache.js', () => ({
      invalidateAnalyticsPerformanceCache,
    }));

    await jest.unstable_mockModule('../src/shared/utils/auditLog.js', () => ({
      auditLog: jest.fn(),
    }));

    const { updateShipmentStatusService } = await import('../src/modules/shipments/shipments.service.js');

    const result = await updateShipmentStatusService('shipment-1', 'DELIVERED' as any);

    expect(result).toBeTruthy();
    expect(invalidateAnalyticsPerformanceCache).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(emitStatusUpdate).toHaveBeenCalledTimes(1);
  });
});
