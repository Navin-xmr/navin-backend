import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ChainAdapter } from '../src/services/chain/types.js';
import type { ChainEvent } from '../src/shared/types/chain.js';

const ledgerUpdateOneMock = jest.fn();
const telemetryUpdateManyMock = jest.fn();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
  },
}));

await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
  Telemetry: {
    updateMany: telemetryUpdateManyMock,
  },
  TelemetryAnchorStatus: {
    PENDING_ANCHOR: 'PENDING_ANCHOR',
    ANCHORED: 'ANCHORED',
    ANCHOR_FAILED: 'ANCHOR_FAILED',
    VERIFIED: 'VERIFIED',
  },
}));

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

describe('stellar indexer worker - event driven', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockReset();
    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });
    telemetryUpdateManyMock.mockReset();
    telemetryUpdateManyMock.mockResolvedValue({ modifiedCount: 1 });
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

  it('transitions anchored telemetry records with matching stellarTxHash to VERIFIED (#837)', async () => {
    const txHash = '22'.repeat(32);
    const mockEvents: ChainEvent[] = [
      {
        id: 'evt-telemetry-1',
        contract_id: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
        tx_hash: txHash,
        ledger: 250,
        ledger_closed_at: '2026-09-27T12:00:00Z',
        name: 'anchor',
        topic: ['anchor', 'ship-telemetry-1'],
        data: ['b'.repeat(64), 250],
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

    await indexStellarTransactions(mockAdapter);

    expect(telemetryUpdateManyMock).toHaveBeenCalledWith(
      {
        stellarTxHash: txHash,
        anchorStatus: 'ANCHORED',
      },
      {
        $set: {
          anchorStatus: 'VERIFIED',
          verified: true,
          confirmationMetadata: {
            ledger: 250,
            ledgerClosedAt: '2026-09-27T12:00:00Z',
            eventId: 'evt-telemetry-1',
          },
        },
      }
    );
  });
});
