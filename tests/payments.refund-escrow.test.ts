/**
 * P14-08 / #1032 — cancel → refund → release-blocked.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Types } from 'mongoose';

import {
  createChainAdapterMock,
  createChainFactoryMock,
  createSocketIoMock,
} from './helpers/mocks.js';

const shipmentId = new Types.ObjectId();
const paymentId = new Types.ObjectId();
const actor = `G${'A'.repeat(55)}`;
const chainAmount = '1500000000';

const adapter = createChainAdapterMock({
  refundEscrow: jest.fn(async () => ({
    txHash: 'e'.repeat(64),
    ledger: 7,
    simulated: true,
    shipmentId: shipmentId.toString(),
  })),
});

const refundPayment = jest.fn(async (_id: string, amount: string) => ({
  _id,
  shipmentId,
  amount: Number(amount),
  status: 'Refunded',
  refundAmount: amount,
}));
const updatePaymentStatus = jest.fn(async () => null);
let payment: Record<string, unknown>;
let shipmentStatus = 'CANCELLED';

jest.resetModules();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentById: jest.fn(async () => payment),
  getPaymentByShipmentId: jest.fn(async () => payment),
  refundPayment,
  updatePaymentStatus,
  createPayment: jest.fn(),
  getPaymentsByOrganization: jest.fn(),
  disputePayment: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/chain/factory.js', () =>
  createChainFactoryMock(adapter)
);

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    findById: jest.fn(() => ({
      lean: async () => ({ status: shipmentStatus }),
    })),
  },
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => createSocketIoMock());
await jest.unstable_mockModule('../src/shared/utils/auditLog.js', () => ({
  auditLog: jest.fn(),
}));

const service = await import('../src/modules/payments/payments.service.js');
const { ErrorCodes } = await import('../src/shared/http/errors.js');

describe('P14-08 escrow refund', () => {
  beforeEach(() => {
    payment = { _id: paymentId, shipmentId, amount: 150, status: 'Escrowed' };
    shipmentStatus = 'CANCELLED';
    jest.clearAllMocks();
  });

  it('cancels → refunds on-chain → status only after reconciliation → blocks release', async () => {
    const receipt = await service.requestEscrowRefundService(paymentId.toString(), {
      caller: actor,
      shipmentId: shipmentId.toString(),
    });
    expect(adapter.refundEscrow).toHaveBeenCalledWith({
      caller: actor,
      shipment_id: shipmentId.toString(),
    });
    expect(receipt.txHash).toBe('e'.repeat(64));
    // Not REFUNDED until the chain event is indexed.
    expect(refundPayment).not.toHaveBeenCalled();

    const reconciled = await service.reconcileEscrowRefundService({
      shipmentId: shipmentId.toString(),
      amount: chainAmount,
      txHash: receipt.txHash,
    });
    expect(refundPayment).toHaveBeenCalledWith(paymentId.toString(), chainAmount, receipt.txHash);
    expect(reconciled.status).toBe('Refunded');

    payment = { ...payment, status: 'Refunded' };
    await expect(
      service.releasePaymentService(paymentId.toString(), 'c'.repeat(64))
    ).rejects.toMatchObject({
      code: ErrorCodes.PAYMENTS_ESCROW_FINAL,
      statusCode: 409,
    });
    expect(updatePaymentStatus).not.toHaveBeenCalled();
  });

  it('rejects a refund whose chain amount differs from the settlement', async () => {
    await expect(
      service.reconcileEscrowRefundService({
        shipmentId: shipmentId.toString(),
        amount: '1',
        txHash: 'e'.repeat(64),
      })
    ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_INVALID_AMOUNT });
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('refuses to refund a shipment that was not cancelled', async () => {
    shipmentStatus = 'IN_TRANSIT';
    await expect(
      service.requestEscrowRefundService(paymentId.toString(), {
        caller: actor,
        shipmentId: shipmentId.toString(),
      })
    ).rejects.toMatchObject({ code: ErrorCodes.PAYMENTS_ESCROW_FINAL });
    expect(adapter.refundEscrow).not.toHaveBeenCalled();
  });
});
