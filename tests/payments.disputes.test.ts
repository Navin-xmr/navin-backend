/**
 * #1036 — dispute creation/resolution calls the contract (raise_dispute,
 * resolve_dispute) with a required reason hash, and the service never
 * decides the resolution outcome locally — that's the indexer's job
 * (tests/stellar-indexer.dispute.test.ts covers the DB-mirrors-the-event half).
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  createChainAdapterMock,
  createChainFactoryMock,
  createSocketIoMock,
} from './helpers/mocks.js';
import { paymentDoc } from './fixtures/factories.js';

const getPaymentByIdMock = jest.fn<(id: string) => Promise<unknown>>();
const disputePaymentMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const submitDisputeResolutionMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentById: getPaymentByIdMock,
  disputePayment: disputePaymentMock,
  submitDisputeResolution: submitDisputeResolutionMock,
  createPayment: jest.fn(),
  updatePaymentStatus: jest.fn(),
  getPaymentByShipmentId: jest.fn(),
  deletePayment: jest.fn(),
}));

const auditLogMock = jest.fn();
await jest.unstable_mockModule('../src/shared/utils/auditLog.js', () => ({
  auditLog: auditLogMock,
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => createSocketIoMock());

const chainAdapter = createChainAdapterMock();
await jest.unstable_mockModule('../src/services/chain/factory.js', () =>
  createChainFactoryMock(chainAdapter)
);

const { disputeSettlementService, resolveSettlementDisputeService } =
  await import('../src/modules/payments/payments.service.js');

describe('disputeSettlementService (#1036)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('raises the dispute on-chain with a required reason hash and freezes escrow', async () => {
    const payment = paymentDoc({ status: 'Pending' });
    getPaymentByIdMock.mockResolvedValueOnce(payment);
    disputePaymentMock.mockResolvedValueOnce(paymentDoc({ status: 'Disputed' }));

    await disputeSettlementService('pay1', { reason: 'carrier lost cargo' }, 'user1');

    expect(chainAdapter.raiseDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment_id: payment.shipmentId,
        reason_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
    expect(disputePaymentMock).toHaveBeenCalledWith(
      'pay1',
      'carrier lost cargo',
      undefined,
      expect.objectContaining({ reasonHash: expect.any(String), txHash: expect.any(String) })
    );
  });

  it('propagates an unmapped contract rejection instead of guessing locally', async () => {
    getPaymentByIdMock.mockResolvedValueOnce(paymentDoc());
    const err = new Error('contract rejected: EscrowLocked');
    chainAdapter.raiseDispute.mockRejectedValueOnce(err);

    await expect(disputeSettlementService('pay1', { reason: 'x' })).rejects.toBe(err);
    expect(disputePaymentMock).not.toHaveBeenCalled();
  });
});

describe('resolveSettlementDisputeService (#1036)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits resolve_dispute on-chain without deciding the outcome locally', async () => {
    const disputed = paymentDoc({ status: 'Disputed' });
    getPaymentByIdMock.mockResolvedValueOnce(disputed);
    submitDisputeResolutionMock.mockResolvedValueOnce(disputed);

    const result = await resolveSettlementDisputeService('pay1', { outcome: 'resolved' }, 'admin1');

    expect(chainAdapter.resolveDispute).toHaveBeenCalledWith(
      expect.objectContaining({ shipment_id: disputed.shipmentId, outcome: 'resolved' })
    );
    expect(submitDisputeResolutionMock).toHaveBeenCalledWith('pay1', expect.any(String));
    // The service returns the payment as submitted-for-resolution — still
    // whatever status submitDisputeResolution returned, never decided here.
    expect(result.status).toBe('Disputed');
  });

  it('rejects resolving a settlement with no open dispute', async () => {
    getPaymentByIdMock.mockResolvedValueOnce(paymentDoc({ status: 'Escrowed' }));

    await expect(
      resolveSettlementDisputeService('pay1', { outcome: 'resolved' })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(chainAdapter.resolveDispute).not.toHaveBeenCalled();
  });
});
