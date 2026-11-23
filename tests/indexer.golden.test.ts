import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import type { ChainAdapter } from '../src/services/chain/types.js';
import type { ChainEvent } from '../src/shared/types/chain.js';

const ledgerUpdateOneMock = jest.fn();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
  },
}));

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

describe('Event-driven indexer golden fixtures replay', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockReset();
    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });
  });

  it('replays golden events fixture and upserts exact LedgerBlock rows byte-for-byte per spec', async () => {
    const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/chain/events.json');
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const events: ChainEvent[] = [
      fixtureData.events.anchor,
      fixtureData.events.esc_init,
      fixtureData.events.esc_rel,
      fixtureData.events.esc_dispute,
      fixtureData.events.esc_resolve,
      fixtureData.events.esc_freeze,
      fixtureData.events.esc_unfreeze,
    ];

    const mockAdapter: ChainAdapter = {
      async anchorEvent() {
        throw new Error('Not implemented');
      },
      async releaseEscrow() {
        throw new Error('Not implemented');
      },
      async getConfirmationCount(_txHash: string) {
        return 100;
      },
      async *streamEvents() {
        for (const ev of events) {
          yield ev;
        }
      },
    };

    const summary = await indexStellarTransactions(mockAdapter);

    expect(summary.processed).toBe(7);
    expect(summary.upserted).toBe(7);
    expect(summary.lastCursor).toBe(events[6].id);

    // Verify call 1: anchor -> IN_TRANSIT
    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      1,
      { transactionHash: events[0].tx_hash },
      {
        $setOnInsert: {
          shipmentId: '65f1a2b3c4d5e6f708192a3b',
          milestoneEvent: 'IN_TRANSIT',
          transactionHash: events[0].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: {
          milestoneEvent: 'IN_TRANSIT',
          dataHash: events[0].data[0],
          metadata: {
            blockNumber: 512345,
            ledger: 512345,
            contractId: events[0].contract_id,
            eventId: events[0].id,
            dataHash: events[0].data[0],
            indexedAt: expect.any(String),
          },
        },
      },
      { upsert: true }
    );

    // Verify call 2: esc_init -> SETTLEMENT_INITIATED
    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      2,
      { transactionHash: events[1].tx_hash },
      {
        $setOnInsert: {
          shipmentId: '65f1a2b3c4d5e6f708192a3b',
          milestoneEvent: 'SETTLEMENT_INITIATED',
          transactionHash: events[1].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: {
          milestoneEvent: 'SETTLEMENT_INITIATED',
          metadata: {
            blockNumber: 512346,
            ledger: 512346,
            contractId: events[1].contract_id,
            eventId: events[1].id,
            paymentId: '66a0b1c2d3e4f50617283940',
            payer: events[1].data[1],
            payee: events[1].data[2],
            token: events[1].data[3],
            amount: '1500000000',
            indexedAt: expect.any(String),
          },
        },
      },
      { upsert: true }
    );

    // Verify call 3: esc_rel -> SETTLEMENT_COMPLETED
    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      3,
      { transactionHash: events[2].tx_hash },
      {
        $setOnInsert: {
          shipmentId: '66a0b1c2d3e4f50617283940',
          milestoneEvent: 'SETTLEMENT_COMPLETED',
          transactionHash: events[2].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: {
          milestoneEvent: 'SETTLEMENT_COMPLETED',
          metadata: {
            blockNumber: 512400,
            ledger: 512400,
            contractId: events[2].contract_id,
            eventId: events[2].id,
            paymentId: '66a0b1c2d3e4f50617283940',
            proofHash: events[2].data[0],
            payee: events[2].data[1],
            amount: '1500000000',
            indexedAt: expect.any(String),
          },
        },
      },
      { upsert: true }
    );

    // Verify call 4: esc_dispute -> DISPUTED (reason hash stored, no free-text parsing)
    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      4,
      { transactionHash: events[3].tx_hash },
      {
        $setOnInsert: {
          shipmentId: '66a0b1c2d3e4f50617283940',
          milestoneEvent: 'DISPUTED',
          transactionHash: events[3].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: {
          milestoneEvent: 'DISPUTED',
          metadata: {
            blockNumber: 512450,
            ledger: 512450,
            contractId: events[3].contract_id,
            eventId: events[3].id,
            paymentId: '66a0b1c2d3e4f50617283940',
            reasonHash: events[3].data[0],
            indexedAt: expect.any(String),
          },
        },
      },
      { upsert: true }
    );

    // Verify call 5: esc_resolve -> RESOLVED (outcome reflected, not inferred)
    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      5,
      { transactionHash: events[4].tx_hash },
      {
        $setOnInsert: {
          shipmentId: '66a0b1c2d3e4f50617283940',
          milestoneEvent: 'RESOLVED',
          transactionHash: events[4].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: {
          milestoneEvent: 'RESOLVED',
          metadata: {
            blockNumber: 512500,
            ledger: 512500,
            contractId: events[4].contract_id,
            eventId: events[4].id,
            paymentId: '66a0b1c2d3e4f50617283940',
            outcome: events[4].data[0],
            indexedAt: expect.any(String),
          },
        },
      },
      { upsert: true }
    );

    // Verify call 6: esc_freeze -> ESCROW_FROZEN
    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      6,
      { transactionHash: events[5].tx_hash },
      {
        $setOnInsert: {
          shipmentId: '66a0b1c2d3e4f50617283940',
          milestoneEvent: 'ESCROW_FROZEN',
          transactionHash: events[5].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: {
          milestoneEvent: 'ESCROW_FROZEN',
          metadata: {
            blockNumber: 512520,
            ledger: 512520,
            contractId: events[5].contract_id,
            eventId: events[5].id,
            paymentId: '66a0b1c2d3e4f50617283940',
            frozen: true,
            indexedAt: expect.any(String),
          },
        },
      },
      { upsert: true }
    );

    // Verify call 7: esc_unfreeze -> ESCROW_UNFROZEN
    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      7,
      { transactionHash: events[6].tx_hash },
      {
        $setOnInsert: {
          shipmentId: '66a0b1c2d3e4f50617283940',
          milestoneEvent: 'ESCROW_UNFROZEN',
          transactionHash: events[6].tx_hash,
          actor: 'stellar-indexer',
        },
        $set: {
          milestoneEvent: 'ESCROW_UNFROZEN',
          metadata: {
            blockNumber: 512540,
            ledger: 512540,
            contractId: events[6].contract_id,
            eventId: events[6].id,
            paymentId: '66a0b1c2d3e4f50617283940',
            frozen: false,
            indexedAt: expect.any(String),
          },
        },
      },
      { upsert: true }
    );

    // Only the anchor promotes its hash to the top-level indexed LedgerBlock.dataHash.
    const [anchorBlock, initBlock, releaseBlock] = ledgerUpdateOneMock.mock.calls.map(
      ([, update]) => (update as { $set: Record<string, unknown> }).$set
    );
    expect(anchorBlock.dataHash).toBe(events[0].data[0]);
    expect(initBlock).not.toHaveProperty('dataHash');
    expect(releaseBlock).not.toHaveProperty('dataHash');
  });
});
