import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const createLedgerBlockMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

await jest.unstable_mockModule('../src/modules/ledger/ledger.service.js', () => ({
  createLedgerBlockService: createLedgerBlockMock,
  getLedgerBlocksService: jest.fn(),
  getLedgerBlockByIdService: jest.fn(),
}));

const mockSave = jest.fn<() => Promise<unknown>>();
let mockShipmentDoc: Record<string, unknown> = {};

const findByIdMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

const findByIdAndUpdateMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    findById: findByIdMock,
    findByIdAndUpdate: findByIdAndUpdateMock,
  },
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

jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    findById: jest.fn<(...args: unknown[]) => unknown>().mockReturnValue({
      select: jest.fn<(...args: unknown[]) => unknown>().mockReturnValue({
        lean: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      }),
    }),
  },
}));

jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  emitStatusUpdate: jest.fn(),
  emitPaymentStatusChange: jest.fn(),
}));

jest.unstable_mockModule('../src/shared/utils/auditLog.js', () => ({
  auditLog: jest.fn(),
}));

jest.unstable_mockModule('../src/modules/analytics/analytics.cache.js', () => ({
  invalidateAnalyticsPerformanceCache: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../src/modules/shipments/shipmentsEta.cache.js', () => ({
  invalidateShipmentEtaCache: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  readShipmentEtaCache: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  writeShipmentEtaCache: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
  tokenizeShipment: jest
    .fn<() => Promise<{ stellarTokenId: string; stellarTxHash: string }>>()
    .mockResolvedValue({ stellarTokenId: 'tok', stellarTxHash: 'tx123' }),
  releaseEscrow: jest.fn(),
  anchorTelemetryHash: jest.fn(),
  getStellarExplorerUrl: jest.fn(),
}));

jest.unstable_mockModule('../src/services/mockStorageService.js', () => ({
  mockUploadToStorage: jest
    .fn<() => Promise<string>>()
    .mockResolvedValue('https://mock-storage.com/proof.jpg'),
}));

jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentByShipmentId: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  updatePaymentStatus: jest.fn(),
}));

const { updateShipmentStatusService, uploadShipmentProofService } = await import(
  '../src/modules/shipments/shipments.service.js'
);

describe('Ledger block creation on lifecycle events', () => {
  beforeEach(() => {
    createLedgerBlockMock.mockReset();
    createLedgerBlockMock.mockResolvedValue({
      _id: 'ledger-1',
      shipmentId: 'ship-1',
      eventType: 'CREATED',
      createdAt: new Date(),
    });
    findByIdAndUpdateMock.mockReset();
    findByIdAndUpdateMock.mockResolvedValue({
      _id: 'ship-1',
      trackingNumber: 'TRK-1',
      stellarTxHash: 'tx123',
    });
  });

  it('status change creates a ledger block', async () => {
    const now = new Date();
    mockShipmentDoc = {
      _id: 'ship-1',
      status: 'CREATED',
      milestones: [],
      updatedAt: now,
      save: mockSave.mockImplementation(async function (this: Record<string, unknown>) {
        this.status = 'IN_TRANSIT';
        (this.milestones as unknown[]).push({
          name: 'IN_TRANSIT',
          timestamp: now,
          description: 'Status changed to IN_TRANSIT',
        });
        return this;
      }),
    };

    findByIdMock.mockResolvedValue(mockShipmentDoc);

    const result = await updateShipmentStatusService('ship-1', 'IN_TRANSIT' as never, {
      userId: 'user-1',
    });

    expect(result).toBeTruthy();
    expect(createLedgerBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: 'ship-1',
        eventType: 'IN_TRANSIT',
        actor: 'user-1',
      })
    );
  });

  it('proof upload creates a PROOF_SUBMITTED ledger block', async () => {
    const mockFile = {
      originalname: 'proof.jpg',
      buffer: Buffer.from('fake'),
      mimetype: 'image/jpeg',
      size: 123,
      fieldname: 'file',
      destination: '',
      filename: 'proof.jpg',
      path: '',
      stream: null as unknown as NodeJS.ReadableStream,
    } as Express.Multer.File;

    findByIdMock.mockResolvedValue({
      _id: 'ship-1',
      stellarTxHash: 'tx123',
    });

    await uploadShipmentProofService('ship-1', mockFile, {
      recipientSignatureName: 'Jane Doe',
      notes: 'Delivered',
    });

    expect(createLedgerBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: 'ship-1',
        milestoneEvent: 'PROOF_SUBMITTED',
      })
    );
  });

  it('settlement initiation creates a SETTLEMENT_INITIATED ledger block', async () => {
    const { releaseEscrow } = await import('../src/services/stellar.service.js');
    const paymentsRepo = await import('../src/modules/payments/payments.repo.js');

    (releaseEscrow as jest.MockedFunction<typeof releaseEscrow>).mockResolvedValue({
      success: true,
      transactionHash: 'stellar-tx-hash-abc',
    });
    (paymentsRepo.getPaymentByShipmentId as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockResolvedValue({
      _id: 'pay-1',
      shipmentId: 'ship-1',
      organizationId: 'org-1',
      amount: 100,
      tokenType: 'USDC',
      token: 'USDC',
      status: 'Escrowed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (paymentsRepo.updatePaymentStatus as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockResolvedValue({
      _id: 'pay-1',
      shipmentId: 'ship-1',
      organizationId: 'org-1',
      amount: 100,
      tokenType: 'USDC',
      token: 'USDC',
      status: 'Released',
      stellarTxHash: 'stellar-tx-hash-abc',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    mockShipmentDoc = {
      _id: 'ship-1',
      status: 'OUT_FOR_DELIVERY',
      milestones: [],
      stellarTxHash: undefined,
      updatedAt: now,
      save: mockSave.mockImplementation(async function (this: Record<string, unknown>) {
        this.status = 'DELIVERED';
        (this.milestones as unknown[]).push({
          name: 'DELIVERED',
          timestamp: now,
          description: 'Status changed to DELIVERED',
        });
        return this;
      }),
    };

    findByIdMock.mockResolvedValue(mockShipmentDoc);

    await updateShipmentStatusService('ship-1', 'DELIVERED' as never, {
      userId: 'user-1',
    });

    expect(createLedgerBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: 'ship-1',
        eventType: 'SETTLEMENT_INITIATED',
        transactionHash: 'stellar-tx-hash-abc',
      })
    );
  });
});
