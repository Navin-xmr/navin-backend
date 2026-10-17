import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ChainAdapter } from '../src/services/chain/types.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import { PaymentStatus } from '../src/modules/payments/payments.model.js';

const ledgerUpdateOneMock = jest.fn();
const paymentFindOneMock = jest.fn();
const paymentUpdateOneMock = jest.fn();
const emitPaymentStatusChangeMock = jest.fn();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
  },
}));

await jest.unstable_mockModule('../src/modules/payments/payments.model.js', () => ({
  PaymentStatus,
  PaymentModel: {
    findOne: paymentFindOneMock,
    updateOne: paymentUpdateOneMock,
  },
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  emitPaymentStatusChange: emitPaymentStatusChangeMock,
}));

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

describe('stellar indexer worker - event driven', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockReset();
    paymentFindOneMock.mockReset();
    paymentUpdateOneMock.mockReset();
    emitPaymentStatusChangeMock.mockReset();

    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });
    paymentUpdateOneMock.mockResolvedValue({ modifiedCount: 1 });
  });

  it('streams events and upserts ledger blocks for anchor, esc_init, and esc_rel', async () => {
    const mockEvents: ChainEvent[] = [
      {
        id: 'evt-1',
        contract_id: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
        tx_hash: '11'.repeat(32),
        ledger: 100,
        ledger_closed_at: '2026-09-27T10:00:00Z',
        name: 'anchor',
        topic: ['anchor', 'ship-1'],
        data: ['a'.repeat(64), 100],
      },
    ];

    const mockAdapter: ChainAdapter = {
      async anchorEvent() {
        throw new Error('Not implemented');
      },
      async releaseEscrow() {
        throw new Error('Not implemented');
      },
      async *streamEvents() {
        for (const ev of mockEvents) {
          yield ev;
        }
      },
    };

    const result = await indexStellarTransactions(mockAdapter);

    expect(result.processed).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.lastCursor).toBe('evt-1');
    expect(ledgerUpdateOneMock).toHaveBeenCalledWith(
      { transactionHash: mockEvents[0].tx_hash },
      expect.objectContaining({
        $setOnInsert: {
          shipmentId: 'ship-1',
          eventType: 'IN_TRANSIT',
          transactionHash: mockEvents[0].tx_hash,
          actor: 'stellar-indexer',
        },
      }),
      { upsert: true }
    );
  });

  it('updates confirmations without marking PaymentStatus.COMPLETED or emitting settlement:status when confirmation depth is < 3', async () => {
    const txHash = '22'.repeat(32);
    paymentFindOneMock.mockReturnValue({
      lean: async () => ({
        _id: 'pay_1',
        shipmentId: 'ship_1',
        status: PaymentStatus.PROCESSING,
        amount: 500,
        stellarTxHash: txHash,
      }),
    });

    const mockEvents: ChainEvent[] = [
      {
        id: 'evt-rel-pending',
        contract_id: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
        tx_hash: txHash,
        ledger: 100,
        ledger_closed_at: '2026-09-27T10:00:00Z',
        name: 'esc_rel',
        topic: ['esc_rel', 'pay_1'],
        data: ['b'.repeat(64), 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', '500'],
      },
    ];

    const mockAdapter: ChainAdapter = {
      async anchorEvent() {
        throw new Error('Not implemented');
      },
      async releaseEscrow() {
        throw new Error('Not implemented');
      },
      async *streamEvents() {
        for (const ev of mockEvents) {
          yield ev;
        }
      },
    };

    const result = await indexStellarTransactions(mockAdapter, { latestLedger: 102 });

    expect(result.processed).toBe(1);
    expect(result.verified).toBe(0);
    expect(result.upserted).toBe(0);

    expect(paymentUpdateOneMock).toHaveBeenCalledWith(
      {
        $or: [{ _id: 'pay_1' }, { stellarTxHash: txHash }],
        status: { $ne: PaymentStatus.COMPLETED },
      },
      {
        $set: {
          confirmations: 2,
          stellarTxHash: txHash,
        },
      }
    );
    expect(emitPaymentStatusChangeMock).not.toHaveBeenCalled();
    expect(ledgerUpdateOneMock).not.toHaveBeenCalled();
  });

  it('marks PaymentStatus.COMPLETED and emits settlement:status when confirmation depth is >= 3', async () => {
    const txHash = '33'.repeat(32);
    paymentFindOneMock.mockReturnValue({
      lean: async () => ({
        _id: 'pay_1',
        shipmentId: 'ship_1',
        status: PaymentStatus.PROCESSING,
        amount: 500,
        stellarTxHash: txHash,
      }),
    });

    const mockEvents: ChainEvent[] = [
      {
        id: 'evt-rel-confirmed',
        contract_id: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
        tx_hash: txHash,
        ledger: 100,
        ledger_closed_at: '2026-09-27T10:00:00Z',
        name: 'esc_rel',
        topic: ['esc_rel', 'pay_1'],
        data: ['c'.repeat(64), 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', '500'],
      },
    ];

    const mockAdapter: ChainAdapter = {
      async anchorEvent() {
        throw new Error('Not implemented');
      },
      async releaseEscrow() {
        throw new Error('Not implemented');
      },
      async *streamEvents() {
        for (const ev of mockEvents) {
          yield ev;
        }
      },
    };

    const result = await indexStellarTransactions(mockAdapter, { latestLedger: 103 });

    expect(result.processed).toBe(1);
    expect(result.verified).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.lastCursor).toBe('evt-rel-confirmed');

    expect(paymentUpdateOneMock).toHaveBeenCalledWith(
      {
        $or: [{ _id: 'pay_1' }, { stellarTxHash: txHash }],
        status: { $ne: PaymentStatus.COMPLETED },
      },
      {
        $set: {
          confirmations: 3,
          stellarTxHash: txHash,
          status: PaymentStatus.COMPLETED,
        },
      }
    );

    expect(emitPaymentStatusChangeMock).toHaveBeenCalledWith(
      'ship_1',
      expect.objectContaining({
        paymentId: 'pay_1',
        shipmentId: 'ship_1',
        oldStatus: PaymentStatus.PROCESSING,
        newStatus: PaymentStatus.COMPLETED,
        amount: 500,
        txHash,
        timestamp: expect.any(String),
      })
    );

    expect(ledgerUpdateOneMock).toHaveBeenCalledWith(
      { transactionHash: txHash },
      expect.objectContaining({
        $setOnInsert: {
          shipmentId: 'ship_1',
          eventType: 'SETTLEMENT_COMPLETED',
          transactionHash: txHash,
          actor: 'stellar-indexer',
        },
        $set: {
          metadata: expect.objectContaining({
            confirmations: 3,
            verified: true,
          }),
        },
      }),
      { upsert: true }
    );
  });
});

