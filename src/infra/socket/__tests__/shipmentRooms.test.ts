import { describe, it, expect, jest } from '@jest/globals';

type ShipmentLeanRow = { enterpriseId: string; logisticsId: string } | null;
type ShipmentSelectResult = { lean: () => Promise<ShipmentLeanRow> };
type ShipmentFindByIdResult = { select: () => ShipmentSelectResult };

const mockFindById = jest.fn<(shipmentId: string) => ShipmentFindByIdResult>();
const mockSelect = jest.fn<() => ShipmentSelectResult>();
const mockLean = jest.fn<() => Promise<ShipmentLeanRow>>();

jest.unstable_mockModule('../../../modules/shipments/shipments.model.js', () => ({
  Shipment: {
    findById: mockFindById,
  },
}));

describe('shipmentRooms', () => {
  it('authorizes when organizationId matches enterpriseId', async () => {
    mockLean.mockResolvedValue({ enterpriseId: 'org1', logisticsId: 'org2' });
    mockSelect.mockReturnValue({ lean: mockLean });
    mockFindById.mockReturnValue({ select: mockSelect });

    const mod = await import('../shipmentRooms.js');
    const ok = await mod.isAuthorizedForShipment({ shipmentId: 's1', organizationId: 'org1' });
    expect(ok).toBe(true);
  });

  it('authorizes when organizationId matches logisticsId', async () => {
    mockLean.mockResolvedValue({ enterpriseId: 'org1', logisticsId: 'org2' });
    mockSelect.mockReturnValue({ lean: mockLean });
    mockFindById.mockReturnValue({ select: mockSelect });

    const mod = await import('../shipmentRooms.js');
    const ok = await mod.isAuthorizedForShipment({ shipmentId: 's1', organizationId: 'org2' });
    expect(ok).toBe(true);
  });

  it('rejects when shipment does not exist or org missing', async () => {
    mockLean.mockResolvedValue(null);
    mockSelect.mockReturnValue({ lean: mockLean });
    mockFindById.mockReturnValue({ select: mockSelect });

    const mod = await import('../shipmentRooms.js');
    expect(await mod.isAuthorizedForShipment({ shipmentId: 's1', organizationId: 'org1' })).toBe(
      false
    );
    expect(await mod.isAuthorizedForShipment({ shipmentId: 's1', organizationId: undefined })).toBe(
      false
    );
    expect(await mod.isAuthorizedForShipment({ shipmentId: '', organizationId: 'org1' })).toBe(
      false
    );
  });
});
