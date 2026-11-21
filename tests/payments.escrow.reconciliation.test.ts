import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { ChainEvent } from '../src/shared/types/chain.js';
import { CHAIN_EVENT_NAMES } from '../src/shared/types/chain.js';
import { PaymentStatus } from '../src/modules/payments/payments.model.js';
import { createMockPayment } from './fixtures/factories.js';

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const PAYER = 'GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA';
const PAYEE = 'GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC';
const TOKEN = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';
const SHIPMENT_ID = '65f1a2b3c4d5e6f708192a3b';
const PROOF_HASH = '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d';

const updatePaymentStatusMock = jest.fn();
const emitPaymentStatusChangeMock = jest.fn();
const dispatchAlertMock = jest.fn();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  updatePaymentStatus: updatePaymentStatusMock,
}));
await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  emitPaymentStatusChange: emitPaymentStatusChangeMock,
}));
await jest.unstable_mockModule('../src/services/queue.service.js', () => ({
  dispatchAlert: dispatchAlertMock,
}));

const { reconcileEscrowEvent, applyReconciliation, stroopsTo7Decimal, amountToStroops } =
  await import('../src/modules/payments/payments.reconciliation.js');

function escrowInitEvent(txHash: string, amountStroops: string): ChainEvent {
  return {
    id: 'evt-deposit',
    contract_id: CONTRACT_ID,
    tx_hash: txHash,
    ledger: 512346,
    ledger_closed_at: '2026-09-27T10:15:35Z',
    name: CHAIN_EVENT_NAMES.ESCROW_INIT,
    topic: [CHAIN_EVENT_NAMES.ESCROW_INIT, 'payment-1'],
    data: [SHIPMENT_ID, PAYER, PAYEE, TOKEN, amountStroops],
  };
}

function escrowReleaseEvent(txHash: string, amountStroops: string): ChainEvent {
  return {
    id: 'evt-release',
    contract_id: CONTRACT_ID,
    tx_hash: txHash,
    ledger: 512400,
    ledger_closed_at: '2026-09-27T10:20:10Z',
    name: CHAIN_EVENT_NAMES.ESCROW_RELEASE,
    topic: [CHAIN_EVENT_NAMES.ESCROW_RELEASE, 'payment-1'],
    data: [PROOF_HASH, PAYEE, amountStroops],
  };
}

function escrowReleasedEvent(txHash: string): ChainEvent {
  return {
    id: 'evt-released',
    contract_id: CONTRACT_ID,
    tx_hash: txHash,
    ledger: 512600,
    ledger_closed_at: '2026-09-27T11:00:00Z',
    name: CHAIN_EVENT_NAMES.ESCROW_RELEASED,
    topic: [CHAIN_EVENT_NAMES.ESCROW_RELEASED, SHIPMENT_ID],
    data: [PROOF_HASH, PAYER],
  };
}

function escrowRefundEvent(txHash: string): ChainEvent {
  return {
    id: 'evt-refund',
    contract_id: CONTRACT_ID,
    tx_hash: txHash,
    ledger: 512500,
    ledger_closed_at: '2026-09-27T10:30:00Z',
    name: CHAIN_EVENT_NAMES.ESCROW_RESOLVE,
    topic: [CHAIN_EVENT_NAMES.ESCROW_RESOLVE, 'payment-1'],
    data: ['refund_payer'],
  };
}

describe('stroopsTo7Decimal / amountToStroops (no float drift)', () => {
  it('converts stroops to 7-decimal XLM exactly', () => {
    expect(stroopsTo7Decimal('1500000000')).toBe(150);
    expect(stroopsTo7Decimal('10000000')).toBe(1);
    expect(stroopsTo7Decimal('1234567')).toBeCloseTo(0.1234567, 7);
  });

  it('converts XLM amount to exact stroops', () => {
    expect(amountToStroops(150)).toBe(1500000000n);
    expect(amountToStroops(1)).toBe(10000000n);
    expect(amountToStroops(0.1234567)).toBe(1234567n);
  });
});

describe('reconcileEscrowEvent — escrow_deposited (esc_init)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks the payment ESCROWED with the on-chain amount and tx hash when amounts match', () => {
    const payment = createMockPayment({ amount: 150, status: PaymentStatus.PENDING });
    const event = escrowInitEvent('11'.repeat(32), '1500000000');

    const decision = reconcileEscrowEvent(payment, event);

    expect(decision.reconciled).toBe(true);
    expect(decision.status).toBe(PaymentStatus.ESCROWED);
    expect(decision.amount).toBe(150);
    expect(decision.stellarTxHash).toBe('11'.repeat(32));
    expect(decision.alert).toBeUndefined();
  });

  it('produces an alert and does not change status on amount mismatch', () => {
    const payment = createMockPayment({ amount: 100, status: PaymentStatus.PENDING }); // DB 100 XLM
    const event = escrowInitEvent('11'.repeat(32), '1500000000'); // chain 150 XLM

    const decision = reconcileEscrowEvent(payment, event);

    expect(decision.reconciled).toBe(false);
    expect(decision.status).toBeUndefined();
    expect(decision.alert).toMatchObject({
      type: 'ESCROW_AMOUNT_MISMATCH',
      paymentId: payment._id.toString(),
      shipmentId: payment.shipmentId.toString(),
      chainAmountStroops: '1500000000',
      dbAmountStroops: amountToStroops(100).toString(),
    });
    expect(decision.alert?.message).toContain('mismatch');
    // No status/amount/txHash -- the DB is not overwritten.
    expect(decision.status).toBeUndefined();
    expect(decision.amount).toBeUndefined();
    expect(decision.stellarTxHash).toBeUndefined();
  });
});

describe('reconcileEscrowEvent — escrow_released (esc_rel / escrow_released)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks the payment RELEASED from esc_rel with matching amount and tx hash', () => {
    const payment = createMockPayment({ amount: 150, status: PaymentStatus.ESCROWED });
    const event = escrowReleaseEvent('22'.repeat(32), '1500000000');

    const decision = reconcileEscrowEvent(payment, event);

    expect(decision.reconciled).toBe(true);
    expect(decision.status).toBe(PaymentStatus.RELEASED);
    expect(decision.amount).toBe(150);
    expect(decision.stellarTxHash).toBe('22'.repeat(32));
  });

  it('marks the payment RELEASED from escrow_released (no amount to compare)', () => {
    const payment = createMockPayment({ amount: 150, status: PaymentStatus.ESCROWED });
    const event = escrowReleasedEvent('33'.repeat(32));

    const decision = reconcileEscrowEvent(payment, event);

    expect(decision.reconciled).toBe(true);
    expect(decision.status).toBe(PaymentStatus.RELEASED);
    expect(decision.stellarTxHash).toBe('33'.repeat(32));
    // escrow_released carries no amount, so none is asserted or overwritten.
    expect(decision.amount).toBe(payment.amount);
  });

  it('produces an alert and keeps the payment unreleased on release amount mismatch', () => {
    const payment = createMockPayment({ amount: 100, status: PaymentStatus.ESCROWED });
    const event = escrowReleaseEvent('22'.repeat(32), '1500000000');

    const decision = reconcileEscrowEvent(payment, event);

    expect(decision.reconciled).toBe(false);
    expect(decision.status).toBeUndefined();
    expect(decision.alert?.type).toBe('ESCROW_AMOUNT_MISMATCH');
    // DB is not overwritten: no release status, no tx hash.
    expect(decision.stellarTxHash).toBeUndefined();
  });
});

describe('reconcileEscrowEvent — escrow_refunded (esc_resolve / refund_payer)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks the payment REFUNDED on a refund_payer outcome', () => {
    const payment = createMockPayment({ amount: 150, status: PaymentStatus.ESCROWED });
    const event = escrowRefundEvent('44'.repeat(32));

    const decision = reconcileEscrowEvent(payment, event);

    expect(decision.reconciled).toBe(true);
    expect(decision.status).toBe(PaymentStatus.REFUNDED);
    expect(decision.stellarTxHash).toBe('44'.repeat(32));
    // Refund events carry no amount; the DB amount is not overwritten.
    expect(decision.amount).toBe(payment.amount);
  });

  it('ignores esc_resolve outcomes that are not refunds', () => {
    const payment = createMockPayment();
    const event: ChainEvent = {
      ...escrowRefundEvent('44'.repeat(32)),
      data: ['release_payer'],
    };

    const decision = reconcileEscrowEvent(payment, event);

    expect(decision.reconciled).toBe(false);
    expect(decision.status).toBeUndefined();
    expect(decision.alert).toBeUndefined();
  });
});

describe('applyReconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists status + tx hash and emits settlement:status when reconciled', async () => {
    const payment = createMockPayment({ status: PaymentStatus.ESCROWED, amount: 150 });
    const event = escrowReleaseEvent('22'.repeat(32), '1500000000');
    const decision = reconcileEscrowEvent(payment, event);
    updatePaymentStatusMock.mockResolvedValue(
      createMockPayment({
        status: PaymentStatus.RELEASED,
        stellarTxHash: '22'.repeat(32),
        shipmentId: payment.shipmentId,
      })
    );

    const result = await applyReconciliation(payment, decision);

    expect(updatePaymentStatusMock).toHaveBeenCalledWith(
      payment._id.toString(),
      PaymentStatus.RELEASED,
      '22'.repeat(32)
    );
    expect(emitPaymentStatusChangeMock).toHaveBeenCalledWith(
      payment.shipmentId.toString(),
      expect.objectContaining({
        oldStatus: PaymentStatus.ESCROWED,
        newStatus: PaymentStatus.RELEASED,
        txHash: '22'.repeat(32),
      })
    );
    expect(dispatchAlertMock).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('dispatches an alert and does NOT write to the DB on mismatch', async () => {
    const payment = createMockPayment({ status: PaymentStatus.PENDING, amount: 100 });
    const event = escrowInitEvent('11'.repeat(32), '1500000000');
    const decision = reconcileEscrowEvent(payment, event);

    const result = await applyReconciliation(payment, decision);

    expect(dispatchAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'STATUS_CHANGE',
        shipmentId: payment.shipmentId.toString(),
      })
    );
    expect(updatePaymentStatusMock).not.toHaveBeenCalled();
    expect(emitPaymentStatusChangeMock).not.toHaveBeenCalled();
    expect(result).toBe(payment); // untouched
  });

  it('does not dispatch an alert when there is no alert on a non-reconciled decision', async () => {
    const payment = createMockPayment();
    const decision = { reconciled: false };

    const result = await applyReconciliation(payment, decision);

    expect(dispatchAlertMock).not.toHaveBeenCalled();
    expect(updatePaymentStatusMock).not.toHaveBeenCalled();
    expect(result).toBe(payment);
  });
});
