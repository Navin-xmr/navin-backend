import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ChainAdapter } from '../src/services/chain/types.js';
import type { ChainEvent } from '../src/shared/types/chain.js';

const ledgerUpdateOneMock = jest.fn();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
  },
}));

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

describe('stellar indexer worker - event driven', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockReset();
    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });
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
          milestoneEvent: 'IN_TRANSIT',
          transactionHash: mockEvents[0].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: expect.objectContaining({
          dataHash: 'a'.repeat(64),
          metadata: expect.objectContaining({
            dataHash: 'a'.repeat(64),
          }),
        }),
      }),
      { upsert: true }
    );
  });
});
