/**
 * #997 — createShipmentService writes shipment + outbox atomically and never
 * calls the chain adapter on the request path. The worker owns submission.
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

const saveMock = jest.fn<() => Promise<unknown>>();

class ShipmentDocMock {
  _id = new Types.ObjectId();
  createdAt = CREATED_AT;
  trackingNumber!: string;
  origin!: string;
  destination!: string;
  stellarTokenId?: string;
  stellarTxHash?: string;
  chainOutbox?: {
    status: string;
    idempotencyKey: string;
    attempts: number;
    availableAt: Date;
  };
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

const input = {
  trackingNumber: 'NVN-123456',
  origin: 'Lagos',
  destination: 'Accra',
  actorUserId: new Types.ObjectId().toHexString(),
};

describe('createShipmentService — transactional outbox (#997)', () => {
  beforeEach(() => {
    saveMock.mockReset();
    saveMock.mockResolvedValue(undefined);
    chainAdapter.anchorEvent.mockClear();
    auditLogMock.mockClear();
  });

  it('persists shipment and pending outbox in one atomic save, without a chain call', async () => {
    const shipment = (await createShipmentService(input)) as unknown as ShipmentDocMock;

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(chainFactory.getChainAdapter).not.toHaveBeenCalled();
    expect(chainAdapter.anchorEvent).not.toHaveBeenCalled();
    expect(shipment.chainOutbox).toMatchObject({
      status: 'pending_chain',
      attempts: 0,
    });
    expect(shipment.chainOutbox?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(shipment.stellarTxHash).toBeUndefined();
  });

  it('never calls stellar.service directly', async () => {
    await createShipmentService(input);

    expect(stellarService.tokenizeShipment).not.toHaveBeenCalled();
  });

  it('keeps the outbox durable when the chain is unavailable (no orphan row)', async () => {
    chainAdapter.anchorEvent.mockRejectedValueOnce(new Error('chain unavailable'));

    const shipment = (await createShipmentService(input)) as unknown as ShipmentDocMock;

    // Chain adapter is not on the request path: a chain outage cannot leave a
    // persisted shipment without its outbox entry.
    expect(chainAdapter.anchorEvent).not.toHaveBeenCalled();
    expect(shipment.trackingNumber).toBe(input.trackingNumber);
    expect(shipment.chainOutbox?.status).toBe('pending_chain');
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SHIPMENT_CREATED', resourceId: shipment._id.toString() })
    );
  });
});
