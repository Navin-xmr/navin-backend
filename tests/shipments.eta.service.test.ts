import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { AppError } from '../src/shared/http/errors.js';

type ShipmentLean = {
  _id: string;
  status: string;
  offChainMetadata?: Record<string, unknown>;
};

type TelemetryPoint = {
  latitude: number;
  longitude: number;
  timestamp: Date;
};

type ShipmentFindByIdResult = {
  lean: () => Promise<ShipmentLean | null>;
};

type TelemetryFindResult = {
  select: (projection: string) => {
    sort: (sorting: Record<string, number>) => {
      limit: (limit: number) => {
        lean: () => Promise<TelemetryPoint[]>;
      };
    };
  };
};

const mockShipmentFindById = jest.fn<(id: string) => ShipmentFindByIdResult>();
const mockTelemetryFind = jest.fn<(query: Record<string, unknown>) => TelemetryFindResult>();
const mockReadShipmentEtaCache = jest.fn<(shipmentId: string) => Promise<unknown>>();
const mockWriteShipmentEtaCache = jest.fn<
  (shipmentId: string, payload: unknown) => Promise<void>
>();
const mockInvalidateShipmentEtaCache = jest.fn<(shipmentId: string) => Promise<void>>();

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    findById: mockShipmentFindById,
    find: jest.fn(),
    countDocuments: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
  ShipmentStatus: {
    CREATED: 'CREATED',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  },
}));

await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
  Telemetry: {
    find: mockTelemetryFind,
    updateMany: jest.fn(),
  },
}));

await jest.unstable_mockModule('../src/modules/shipments/shipmentsEta.cache.js', () => ({
  readShipmentEtaCache: mockReadShipmentEtaCache,
  writeShipmentEtaCache: mockWriteShipmentEtaCache,
  invalidateShipmentEtaCache: mockInvalidateShipmentEtaCache,
}));

const { getShipmentEtaService } = await import('../src/modules/shipments/shipments.service.js');

function setupShipment(shipment: ShipmentLean | null): void {
  mockShipmentFindById.mockReturnValue({
    lean: async () => shipment,
  });
}

function setupTelemetry(points: TelemetryPoint[]): void {
  const lean = async () => points;
  const limit = (_limit: number) => ({ lean });
  const sort = (_sorting: Record<string, number>) => ({ limit });
  const select = (_projection: string) => ({ sort });

  mockTelemetryFind.mockReturnValue({ select });
}

describe('getShipmentEtaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadShipmentEtaCache.mockResolvedValue(null);
    mockWriteShipmentEtaCache.mockResolvedValue(undefined);
  });

  it('returns cached ETA payload when available', async () => {
    const cachedPayload = {
      estimatedArrival: '2026-01-01T00:00:00.000Z',
      distanceRemaining: 10,
      averageSpeed: 40,
      confidence: 'HIGH',
    };

    mockReadShipmentEtaCache.mockResolvedValue(cachedPayload);

    const result = await getShipmentEtaService('shipment-cached');

    expect(result).toEqual(cachedPayload);
    expect(mockShipmentFindById).not.toHaveBeenCalled();
    expect(mockTelemetryFind).not.toHaveBeenCalled();
  });

  it('computes ETA for in-transit shipment using telemetry points', async () => {
    setupShipment({
      _id: 'shipment-eta-1',
      status: 'IN_TRANSIT',
      offChainMetadata: {
        destinationCoordinates: { latitude: 6.46, longitude: 3.39 },
      },
    });

    setupTelemetry([
      { latitude: 6.45, longitude: 3.35, timestamp: new Date('2026-01-01T10:00:00.000Z') },
      { latitude: 6.44, longitude: 3.3, timestamp: new Date('2026-01-01T09:55:00.000Z') },
      { latitude: 6.43, longitude: 3.25, timestamp: new Date('2026-01-01T09:50:00.000Z') },
    ]);

    const result = await getShipmentEtaService('shipment-eta-1');

    expect(result.estimatedArrival).not.toBeNull();
    if (result.estimatedArrival !== null) {
      expect(typeof result.estimatedArrival).toBe('string');
      expect(result.distanceRemaining).toBeGreaterThan(0);
      expect(result.averageSpeed).toBeGreaterThan(0);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(result.confidence);
    }

    expect(mockWriteShipmentEtaCache).toHaveBeenCalledTimes(1);
  });

  it('returns null ETA with reason for non-transit shipments', async () => {
    setupShipment({
      _id: 'shipment-eta-2',
      status: 'DELIVERED',
      offChainMetadata: {
        destinationCoordinates: { latitude: 6.46, longitude: 3.39 },
      },
    });

    const result = await getShipmentEtaService('shipment-eta-2');

    expect(result).toEqual({
      estimatedArrival: null,
      reason: 'ETA is available only for IN_TRANSIT shipments',
    });
  });

  it('throws 404 when no GPS telemetry points are available', async () => {
    setupShipment({
      _id: 'shipment-eta-3',
      status: 'IN_TRANSIT',
      offChainMetadata: {
        destinationCoordinates: { latitude: 6.46, longitude: 3.39 },
      },
    });
    setupTelemetry([]);

    await expect(getShipmentEtaService('shipment-eta-3')).rejects.toEqual(
      expect.objectContaining({
        statusCode: 404,
        code: 'ERR_SHIPMENT_ETA_NO_GPS',
      } as Partial<AppError>)
    );
  });
});
