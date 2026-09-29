import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { PaymentStatus } from '../src/modules/payments/payments.model.js';
import { SOCKET_EVENTS } from '../src/shared/types/socketEvents.js';
import type { SettlementStatusPayload } from '../src/shared/types/socketEvents.js';
import { expectSettlementPayload, settlementEmitterMock } from './helpers/socketContract.js';

const STELLAR_TX_HASH = 'f1e2d3c4b5a69788796a5b4c3d2e1f00ffeeddccbbaa99887766554433221100f';

const mockGetPaymentById = jest.fn<() => Promise<unknown>>();
const mockUpdatePaymentStatus = jest.fn<() => Promise<unknown>>();
const mockEmitPaymentStatusChange = settlementEmitterMock();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentById: mockGetPaymentById,
  updatePaymentStatus: mockUpdatePaymentStatus,
  createPayment: jest.fn(),
  getPaymentsByOrganization: jest.fn(),
  getPaymentByShipmentId: jest.fn(),
  deletePayment: jest.fn(),
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  emitPaymentStatusChange: mockEmitPaymentStatusChange,
  emitStatusUpdate: jest.fn(),
  emitTelemetryUpdate: jest.fn(),
  emitAnomalyDetected: jest.fn(),
  emitNotificationNew: jest.fn(),
  initSocketIO: jest.fn(),
  getIO: jest.fn(),
}));

const { updatePaymentStatusService } = await import('../src/modules/payments/payments.service.js');

describe('updatePaymentStatusService WebSocket emission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockPayment(overrides: Record<string, unknown> = {}) {
    return {
      _id: 'pay1',
      shipmentId: { toString: () => 'ship1' },
      amount: 99.5,
      status: PaymentStatus.RELEASED,
      ...overrides,
    };
  }

  it(`emits ${SOCKET_EVENTS.SETTLEMENT_STATUS} after a successful update`, async () => {
    mockGetPaymentById.mockResolvedValue(
      mockPayment({ status: PaymentStatus.PENDING, stellarTxHash: undefined })
    );
    mockUpdatePaymentStatus.mockResolvedValue(mockPayment());

    await updatePaymentStatusService('pay1', { status: PaymentStatus.RELEASED });

    expect(mockEmitPaymentStatusChange).toHaveBeenCalledTimes(1);

    const [shipmentId, rawPayload] = mockEmitPaymentStatusChange.mock.calls[0];
    const payload: SettlementStatusPayload = expectSettlementPayload(rawPayload);

    expect(shipmentId).toBe('ship1');
    expect(payload).toEqual({
      paymentId: 'pay1',
      shipmentId: 'ship1',
      oldStatus: PaymentStatus.PENDING,
      newStatus: PaymentStatus.RELEASED,
      amount: 99.5,
      timestamp: payload.timestamp,
    });
    expect(payload.timestamp).toBe(new Date(Date.parse(payload.timestamp)).toISOString());
  });

  it('propagates the Stellar transaction hash as txHash on the settlement payload', async () => {
    mockGetPaymentById.mockResolvedValue(mockPayment({ status: PaymentStatus.ESCROWED }));
    mockUpdatePaymentStatus.mockResolvedValue(
      mockPayment({ status: PaymentStatus.RELEASED, stellarTxHash: STELLAR_TX_HASH })
    );

    await updatePaymentStatusService('pay1', {
      status: PaymentStatus.RELEASED,
      stellarTxHash: STELLAR_TX_HASH,
    });

    const [, rawPayload] = mockEmitPaymentStatusChange.mock.calls[0];
    const payload: SettlementStatusPayload = expectSettlementPayload(rawPayload);

    expect(payload.txHash).toBe(STELLAR_TX_HASH);
    expect(payload.oldStatus).toBe(PaymentStatus.ESCROWED);
    expect(payload.newStatus).toBe(PaymentStatus.RELEASED);
  });

  it('omits txHash when the status transition carries no Stellar hash', async () => {
    mockGetPaymentById.mockResolvedValue(mockPayment({ status: PaymentStatus.PENDING }));
    mockUpdatePaymentStatus.mockResolvedValue(
      mockPayment({ status: PaymentStatus.DISPUTED, stellarTxHash: undefined })
    );

    await updatePaymentStatusService('pay1', { status: PaymentStatus.DISPUTED });

    const [, rawPayload] = mockEmitPaymentStatusChange.mock.calls[0];
    const payload: SettlementStatusPayload = expectSettlementPayload(rawPayload);

    expect(payload.txHash).toBeUndefined();
  });

  it('does not emit when the payment cannot be found', async () => {
    mockGetPaymentById.mockResolvedValue(null);

    await expect(
      updatePaymentStatusService('missing', { status: PaymentStatus.RELEASED })
    ).rejects.toThrow();

    expect(mockEmitPaymentStatusChange).not.toHaveBeenCalled();
  });
});
