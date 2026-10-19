/**
 * P8-07 — createShipmentService anchors through the ChainAdapter port.
 *
 * Shipment creation must go through `getChainAdapter().anchorEvent(...)`
 * (AGENTS.md §7) and never call `stellar.service.js` directly. The stellar
 * service is mocked so any lingering call would be caught and asserted on.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Types } from 'mongoose';
import {
  createChainAdapterMock,
  createChainFactoryMock,
  createSocketIoMock,
  createStellarServiceMock,
} from './helpers/mocks.js';

const CREATED_AT = new Date('2026-10-01T12:00:00.000Z');
const ACTOR_ADDRESS = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';

const saveMock = jest.fn<() => Promise<unknown>>();

class ShipmentDocMock {
  _id = new Types.ObjectId();
  createdAt = CREATED_AT;
  trackingNumber!: string;
  origin!: string;
  destination!: string;
  stellarTokenId?: string;
  stellarTxHash?: string;
  save = saveMock;

  constructor(data: Record<string, unknown>) {
    Object.assign(this, data);
  }
}

jest.resetModules();

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: ShipmentDocMock,
  ShipmentStatus: {
    CREATED: 'CREATED',
    PICKUP_CONFIRMED: 'PICKUP_CONFIRMED',
    IN_TRANSIT: 'IN_TRANSIT',
    CUSTOMS_CLEARED: 'CUSTOMS_CLEARED',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
    SETTLEMENT_INITIATED: 'SETTLEMENT_INITIATED',
    SETTLEMENT_COMPLETED: 'SETTLEMENT_COMPLETED',
    CANCELLED: 'CANCELLED',
  },
}));

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: { findById: jest.fn() },
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => createSocketIoMock());

const auditLogMock = jest.fn();
await jest.unstable_mockModule('../src/shared/utils/auditLog.js', () => ({
  auditLog: auditLogMock,
}));

await jest.unstable_mockModule('../src/modules/analytics/analytics.cache.js', () => ({
  invalidateAnalyticsPerformanceCache: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

await jest.unstable_mockModule('../src/modules/shipments/shipmentsEta.cache.js', () => ({
  invalidateShipmentEtaCache: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  readShipmentEtaCache: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  writeShipmentEtaCache: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

await jest.unstable_mockModule('../src/modules/ledger/ledger.service.js', () => ({
  createLedgerBlockService: jest.fn(),
  getLedgerBlocksService: jest.fn(),
  getLedgerBlockByIdService: jest.fn(),
  getLedgerBlockVerificationService: jest.fn(),
}));

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentByShipmentId: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  updatePaymentStatus: jest.fn(),
}));

const stellarService = createStellarServiceMock();
await jest.unstable_mockModule('../src/services/stellar.service.js', () => stellarService);

const chainAdapter = createChainAdapterMock();
const chainFactory = createChainFactoryMock(chainAdapter);
await jest.unstable_mockModule('../src/services/chain/factory.js', () => chainFactory);

const { createShipmentService } = await import('../src/modules/shipments/shipments.service.js');
const { buildCanonicalShipmentPayload, generateDataHash } = await import(
  '../src/shared/utils/crypto.js'
);

const input = {
  trackingNumber: 'NVN-123456',
  origin: 'Lagos',
  destination: 'Accra',
  actorUserId: new Types.ObjectId().toHexString(),
};

describe('createShipmentService — ChainAdapter anchoring (P8-07)', () => {
  beforeEach(() => {
    saveMock.mockReset();
    saveMock.mockResolvedValue(undefined);
    chainAdapter.anchorEvent.mockClear();
    auditLogMock.mockClear();
  });

  it('anchors the creation via getChainAdapter().anchorEvent and records the tx', async () => {
    const txHash = 'b'.repeat(64);
    chainAdapter.anchorEvent.mockResolvedValueOnce({ txHash, ledger: 7, simulated: true });

    const shipment = (await createShipmentService(input)) as unknown as ShipmentDocMock;
    const shipmentId = shipment._id.toString();

    const expectedHash = generateDataHash(
      buildCanonicalShipmentPayload({
        shipmentId,
        event: 'CREATED',
        actor: input.actorUserId,
        timestamp: CREATED_AT,
        metadata: {
          trackingNumber: input.trackingNumber,
          origin: input.origin,
          destination: input.destination,
        },
      })
    );

    expect(chainFactory.getChainAdapter).toHaveBeenCalled();
    expect(chainAdapter.anchorEvent).toHaveBeenCalledTimes(1);
    expect(chainAdapter.anchorEvent).toHaveBeenCalledWith({
      shipment_id: shipmentId,
      data_hash: expectedHash,
      actor: ACTOR_ADDRESS,
    });
    expect(shipment.stellarTxHash).toBe(txHash);
    expect(shipment.stellarTokenId).toBe(`stellar:${shipmentId}:${txHash.slice(0, 8)}`);
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it('never calls stellar.service directly', async () => {
    await createShipmentService(input);

    expect(stellarService.tokenizeShipment).not.toHaveBeenCalled();
  });

  it('still returns the shipment when anchoring fails', async () => {
    chainAdapter.anchorEvent.mockRejectedValueOnce(new Error('chain unavailable'));

    const shipment = (await createShipmentService(input)) as unknown as ShipmentDocMock;

    expect(shipment.trackingNumber).toBe(input.trackingNumber);
    expect(shipment.stellarTxHash).toBeUndefined();
    expect(shipment.stellarTokenId).toBeUndefined();
    // Only the initial persist — no second save without a receipt.
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SHIPMENT_CREATED', resourceId: shipment._id.toString() })
    );
  });
});
