import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Types } from 'mongoose';

const FIRST_SHIPMENT_ID = new Types.ObjectId().toString();
const SECOND_SHIPMENT_ID = new Types.ObjectId().toString();

const paymentFindMock = jest.fn();
const ledgerUpdateOneMock = jest.fn();

await jest.unstable_mockModule('../src/modules/payments/payments.model.js', () => ({
  PaymentModel: {
    find: paymentFindMock,
  },
}));

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
  },
}));

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

describe('stellar indexer worker', () => {
  beforeEach(() => {
    paymentFindMock.mockReset();
    ledgerUpdateOneMock.mockReset();
  });

  it('creates/upserts a ledger block from mocked Stellar transaction data', async () => {
    paymentFindMock.mockReturnValue({
      select: () => ({
        lean: async () => [{ shipmentId: FIRST_SHIPMENT_ID, stellarTxHash: 'tx-1' }],
      }),
    });

    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });

    const client = {
      getLatestLedger: async () => 105,
      getTransaction: async () => ({ hash: 'tx-1', ledger: 100, memo: 'SETTLEMENT_COMPLETED' }),
    };

    const result = await indexStellarTransactions(client);

    expect(result.processed).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.verified).toBe(1);
    expect(ledgerUpdateOneMock).toHaveBeenCalledTimes(1);
  });

  it('handles duplicate transaction hashes idempotently', async () => {
    paymentFindMock.mockReturnValue({
      select: () => ({
        lean: async () => [
          { shipmentId: FIRST_SHIPMENT_ID, stellarTxHash: 'tx-dup' },
          { shipmentId: SECOND_SHIPMENT_ID, stellarTxHash: 'tx-dup' },
        ],
      }),
    });

    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });

    const client = {
      getLatestLedger: async () => 101,
      getTransaction: async () => ({ hash: 'tx-dup', ledger: 100, memo: 'SETTLEMENT_COMPLETED' }),
    };

    const result = await indexStellarTransactions(client);

    expect(result.processed).toBe(1);
    expect(ledgerUpdateOneMock).toHaveBeenCalledTimes(1);
  });

  it('throws when chain query fails so BullMQ can retry with backoff', async () => {
    paymentFindMock.mockReturnValue({
      select: () => ({
        lean: async () => [{ shipmentId: FIRST_SHIPMENT_ID, stellarTxHash: 'tx-fail' }],
      }),
    });

    const client = {
      getLatestLedger: async () => 100,
      getTransaction: async () => {
        throw new Error('horizon unavailable');
      },
    };

    await expect(indexStellarTransactions(client)).rejects.toThrow('horizon unavailable');
  });
});
