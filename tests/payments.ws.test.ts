import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { PaymentStatus } from '../src/modules/payments/payments.model.js';

const mockGetPaymentById = jest.fn<() => Promise<unknown>>();
const mockUpdatePaymentStatus = jest.fn<() => Promise<unknown>>();
const mockEmitPaymentStatusChange = jest.fn();

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
  initSocketIO: jest.fn(),
  getIO: jest.fn(),
}));

const { updatePaymentStatusService } = await import('../src/modules/payments/payments.service.js');

describe('updatePaymentStatusService WebSocket emission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits payment_status_changed after a successful update', async () => {
    mockGetPaymentById.mockResolvedValue({
      _id: 'pay1',
      shipmentId: { toString: () => 'ship1' },
      amount: 99.5,
      status: PaymentStatus.PENDING,
    });

    mockUpdatePaymentStatus.mockResolvedValue({
      _id: 'pay1',
      shipmentId: { toString: () => 'ship1' },
      amount: 99.5,
      status: PaymentStatus.RELEASED,
    });

    await updatePaymentStatusService('pay1', { status: PaymentStatus.RELEASED });

    expect(mockEmitPaymentStatusChange).toHaveBeenCalledTimes(1);
    expect(mockEmitPaymentStatusChange).toHaveBeenCalledWith(
      'ship1',
      expect.objectContaining({
        paymentId: 'pay1',
        shipmentId: 'ship1',
        oldStatus: PaymentStatus.PENDING,
        newStatus: PaymentStatus.RELEASED,
        amount: 99.5,
      })
    );
  });
});
