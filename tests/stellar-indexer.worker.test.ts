import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { CHAIN_EVENT_NAMES } from '../src/shared/types/chain.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import { createMockPayment, createMockShipment } from './fixtures/factories.js';

const ledgerUpdateOneMock = jest.fn();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
  },
}));

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const PAYEE = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';

function adapterStreaming(events: ChainEvent[]): ChainAdapter {
  return {
    async anchorEvent() {
      throw new Error('Not implemented');
    },
    async releaseEscrow() {
      throw new Error('Not implemented');
    },
    async *streamEvents() {
      yield* events;
    },
  };
}

/** The `$set` stage of the n-th (0-based) LedgerBlock upsert. */
function nthSet(n: number): Record<string, unknown> {
  const [, update] = ledgerUpdateOneMock.mock.calls[n] as [
    unknown,
    { $set: Record<string, unknown> },
  ];
  return update.$set;
}

describe('stellar indexer worker - event driven', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockReset();
    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });
  });

  it('streams an anchor event and upserts its ledger block', async () => {
    const shipment = createMockShipment();
    const mockEvents: ChainEvent[] = [
      {
        id: 'evt-1',
        contract_id: CONTRACT_ID,
        tx_hash: '11'.repeat(32),
        ledger: 100,
        ledger_closed_at: '2026-09-27T10:00:00Z',
        name: CHAIN_EVENT_NAMES.ANCHOR,
        topic: [CHAIN_EVENT_NAMES.ANCHOR, shipment._id],
        data: ['a'.repeat(64), 100],
      },
    ];

    const result = await indexStellarTransactions(adapterStreaming(mockEvents));

    expect(result.processed).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.lastCursor).toBe('evt-1');
    expect(ledgerUpdateOneMock).toHaveBeenCalledWith(
      { transactionHash: mockEvents[0].tx_hash },
      expect.objectContaining({
        $setOnInsert: {
          shipmentId: shipment._id,
          milestoneEvent: 'IN_TRANSIT',
          transactionHash: mockEvents[0].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: expect.objectContaining({
          milestoneEvent: 'IN_TRANSIT',
          dataHash: 'a'.repeat(64),
        }),
      }),
      { upsert: true }
    );
  });

  it('writes the anchor data hash to the top-level indexed dataHash field', async () => {
    const shipment = createMockShipment();
    const anchor: ChainEvent = {
      id: 'evt-anchor',
      contract_id: CONTRACT_ID,
      tx_hash: '22'.repeat(32),
      ledger: 101,
      ledger_closed_at: '2026-09-27T10:01:00Z',
      name: CHAIN_EVENT_NAMES.ANCHOR,
      topic: [CHAIN_EVENT_NAMES.ANCHOR, shipment._id],
      data: ['b'.repeat(64), 101],
    };

    await indexStellarTransactions(adapterStreaming([anchor]));

    const block = nthSet(0);
    expect(block.dataHash).toBe(anchor.data[0]);
    expect(block.metadata).toEqual(expect.objectContaining({ dataHash: anchor.data[0] }));
  });

  it('leaves dataHash unset for non-anchor events', async () => {
    const payment = createMockPayment();
    const release: ChainEvent = {
      id: 'evt-release',
      contract_id: CONTRACT_ID,
      tx_hash: '33'.repeat(32),
      ledger: 102,
      ledger_closed_at: '2026-09-27T10:02:00Z',
      name: CHAIN_EVENT_NAMES.ESCROW_RELEASE,
      topic: [CHAIN_EVENT_NAMES.ESCROW_RELEASE, payment._id],
      data: ['c'.repeat(64), PAYEE, '1500000000'],
    };

    await indexStellarTransactions(adapterStreaming([release]));

    expect(nthSet(0)).not.toHaveProperty('dataHash');
  });
});
