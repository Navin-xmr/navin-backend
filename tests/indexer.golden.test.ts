import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  createPaymentModelMock,
  createSocketIoMock,
  createTelemetryModelMock,
} from './helpers/mocks.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import type { ChainEvent } from '../src/shared/types/chain.js';

const ledgerUpdateOneMock = jest.fn();
const paymentFindMock = jest.fn(() => ({ lean: async () => [] }));
const paymentFindOneAndUpdateMock = jest.fn((): { lean: () => Promise<unknown> } => ({
  lean: async () => null,
}));
const telemetryFindMock = jest.fn(() => ({ lean: async () => [] }));
const telemetryFindOneAndUpdateMock = jest.fn((): { lean: () => Promise<unknown> } => ({
  lean: async () => null,
}));
const telemetryUpdateOneMock = jest.fn();
const paymentModelMock = createPaymentModelMock({
  PaymentModel: { find: paymentFindMock, findOneAndUpdate: paymentFindOneAndUpdateMock },
});
const telemetryModelMock = createTelemetryModelMock({
  Telemetry: {
    find: telemetryFindMock,
    findOneAndUpdate: telemetryFindOneAndUpdateMock,
    updateOne: telemetryUpdateOneMock,
  },
});
const socketIoMock = createSocketIoMock();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
  },
}));
await jest.unstable_mockModule('../src/modules/payments/payments.model.js', () => paymentModelMock);
await jest.unstable_mockModule(
  '../src/modules/telemetry/telemetry.model.js',
  () => telemetryModelMock
);
await jest.unstable_mockModule('../src/infra/socket/io.js', () => socketIoMock);

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
    ];

    const mockAdapter: ChainAdapter = {
      async anchorEvent() {
        throw new Error('Not implemented');
      },
      async releaseEscrow() {
        throw new Error('Not implemented');
      },
      async *streamEvents() {
        for (const ev of events) {
          yield ev;
        }
      },
      async getConfirmationCount() {
        return 3;
      },
    };

    const summary = await indexStellarTransactions(mockAdapter);

    expect(summary.processed).toBe(3);
    expect(summary.upserted).toBe(3);
    expect(summary.lastCursor).toBe(events[2].id);

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

    // Only the anchor promotes its hash to the top-level indexed LedgerBlock.dataHash.
    const [anchorBlock, initBlock, releaseBlock] = ledgerUpdateOneMock.mock.calls.map(
      ([, update]) => (update as { $set: Record<string, unknown> }).$set
    );
    expect(anchorBlock.dataHash).toBe(events[0].data[0]);
    expect(initBlock).not.toHaveProperty('dataHash');
    expect(releaseBlock).not.toHaveProperty('dataHash');

    // Canonical field assertions (#970): milestoneEvent (never legacy eventType)
    // in every $set/$setOnInsert, and the anchor's top-level dataHash equals the event hash.
    for (const [, update] of ledgerUpdateOneMock.mock.calls as Array<
      [unknown, { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> }]
    >) {
      expect(update.$setOnInsert).toHaveProperty('milestoneEvent');
      expect(update.$setOnInsert).not.toHaveProperty('eventType');
      expect(update.$set.milestoneEvent).toBe(update.$setOnInsert.milestoneEvent);
      expect(update.$set).not.toHaveProperty('eventType');
    }
    expect(anchorBlock.dataHash).toBe((events[0].data as unknown[])[0]);
  });
});
