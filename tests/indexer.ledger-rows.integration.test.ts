/**
 * #1077 — golden fixtures → exact LedgerBlock rows.
 *
 * Feeds the spec fixtures (tests/fixtures/chain/events.json) through the real
 * `indexStellarTransactions` consumer and the real `LedgerBlock` model, into an
 * in-memory collection that applies `$set` / `$setOnInsert` upsert semantics
 * (including MongoDB's rule that one path cannot appear in both operators). The
 * rows that come out must equal tests/fixtures/chain/ledger-rows.json exactly —
 * hashes, counters, keys and statuses — so any drift in the indexer, the event
 * mapping or the fixtures fails CI.
 *
 * Observed behaviour captured by the golden rows (not endorsed by it):
 * - the on-chain ledger is stored in `metadata.blockNumber` / `metadata.ledger`,
 *   not in the top-level `ledger` field;
 * - `esc_rel` rows use the payment id as `shipmentId`, because the event topic
 *   carries only the payment id.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

import {
  createPaymentModelMock,
  createSocketIoMock,
  createTelemetryModelMock,
} from './helpers/mocks.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import { CHAIN_SPEC_VERSION, ChainEventSchema } from '../src/shared/types/chain.js';

type Doc = Record<string, unknown>;
type Update = { $set?: Doc; $setOnInsert?: Doc };

/** Minimal Mongo upsert semantics for the `{ transactionHash }` filter the indexer uses. */
class InMemoryLedgerCollection {
  readonly docs = new Map<string, Doc>();

  updateOne(filter: { transactionHash: string }, update: Update, options?: { upsert?: boolean }) {
    const onInsert = update.$setOnInsert ?? {};
    const set = update.$set ?? {};
    const conflict = Object.keys(set).find(key => key in onInsert);
    if (conflict) {
      throw new Error(`Updating the path '${conflict}' would create a conflict at '${conflict}'`);
    }

    const existing = this.docs.get(filter.transactionHash);
    if (existing) {
      Object.assign(existing, structuredClone(set));
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (!options?.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };

    this.docs.set(filter.transactionHash, structuredClone({ ...filter, ...onInsert, ...set }));
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
  }
}

const collection = new InMemoryLedgerCollection();

const paymentModelMock = createPaymentModelMock({
  PaymentModel: {
    find: jest.fn(() => ({ lean: async () => [] })),
    findOneAndUpdate: jest.fn(() => ({ lean: async () => null })),
  },
});
const telemetryModelMock = createTelemetryModelMock({
  Telemetry: {
    find: jest.fn(() => ({ lean: async () => [] })),
    findOneAndUpdate: jest.fn(() => ({ lean: async () => null })),
    updateOne: jest.fn(),
  },
});

await jest.unstable_mockModule('../src/modules/payments/payments.model.js', () => paymentModelMock);
await jest.unstable_mockModule(
  '../src/modules/telemetry/telemetry.model.js',
  () => telemetryModelMock
);
await jest.unstable_mockModule('../src/infra/socket/io.js', () => createSocketIoMock());

const { LedgerBlock } = await import('../src/modules/ledger/ledger.model.js');
const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

const FIXTURES = path.resolve(process.cwd(), 'tests/fixtures/chain');
const eventsFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'events.json'), 'utf8')) as {
  spec_version: string;
  events: Record<'anchor' | 'esc_init' | 'esc_rel', ChainEvent>;
};
const goldenRows = (
  JSON.parse(fs.readFileSync(path.join(FIXTURES, 'ledger-rows.json'), 'utf8')) as {
    spec_version: string;
    rows: Doc[];
  }
).rows;

const events: ChainEvent[] = [
  eventsFixture.events.anchor,
  eventsFixture.events.esc_init,
  eventsFixture.events.esc_rel,
];

const adapter: ChainAdapter = {
  async anchorEvent() {
    throw new Error('not used');
  },
  async releaseEscrow() {
    throw new Error('not used');
  },
  async *streamEvents() {
    for (const event of events) yield event;
  },
  async getConfirmationCount() {
    return 3;
  },
};

/** Rows in ledger order, JSON-normalized, with the wall-clock `indexedAt` checked and removed. */
function persistedRows(): Doc[] {
  return [...collection.docs.values()]
    .map(doc => JSON.parse(JSON.stringify(doc)) as Doc & { metadata: Doc })
    .sort((a, b) => Number(a.metadata.ledger) - Number(b.metadata.ledger))
    .map(row => {
      expect(row.metadata.indexedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/));
      const { indexedAt: _indexedAt, ...metadata } = row.metadata;
      return { ...row, metadata };
    });
}

describe('indexer golden fixtures → LedgerBlock rows (#1077)', () => {
  beforeEach(() => {
    collection.docs.clear();
    jest
      .spyOn(LedgerBlock, 'updateOne')
      .mockImplementation(((filter: never, update: never, options: never) =>
        collection.updateOne(filter, update, options)) as never);
  });

  it('the fixtures are pinned to the current chain spec and pass the spec schema', () => {
    expect(eventsFixture.spec_version).toBe(CHAIN_SPEC_VERSION);
    for (const event of events) {
      expect(ChainEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('persists exactly the golden rows (hashes, counters, keys, statuses)', async () => {
    const summary = await indexStellarTransactions(adapter);

    expect(summary).toEqual({ processed: 3, upserted: 3, lastCursor: events[2].id });
    expect(persistedRows()).toStrictEqual(goldenRows);
  });

  it('rows carry the event hashes, ledger counters and tx-hash keys from the fixtures', async () => {
    await indexStellarTransactions(adapter);

    const rows = persistedRows() as Array<Doc & { metadata: Doc }>;
    rows.forEach((row, index) => {
      const event = events[index];
      expect(row.transactionHash).toBe(event.tx_hash);
      expect(row.metadata.eventId).toBe(event.id);
      expect(row.metadata.contractId).toBe(event.contract_id);
      expect(row.metadata.blockNumber).toBe(event.ledger);
      expect(row.metadata.ledger).toBe(event.ledger);
    });
    expect(rows.map(row => row.milestoneEvent)).toEqual([
      'IN_TRANSIT',
      'SETTLEMENT_INITIATED',
      'SETTLEMENT_COMPLETED',
    ]);
    // Only the anchor promotes its hash to the top-level indexed field.
    expect(rows.map(row => 'dataHash' in row)).toEqual([true, false, false]);
    expect(rows[0].dataHash).toBe((eventsFixture.events.anchor.data as unknown[])[0]);
  });

  it('every persisted row satisfies the LedgerBlock schema', async () => {
    await indexStellarTransactions(adapter);

    for (const row of persistedRows()) {
      expect(new LedgerBlock(row).validateSync()).toBeUndefined();
    }
  });

  it('never puts a path in both $set and $setOnInsert (MongoDB update conflict)', async () => {
    await expect(indexStellarTransactions(adapter)).resolves.toBeDefined();
  });

  it('replaying the same events is idempotent: no new rows, identical content', async () => {
    await indexStellarTransactions(adapter);
    const first = persistedRows();

    const replay = await indexStellarTransactions(adapter);

    expect(replay).toEqual({ processed: 3, upserted: 0, lastCursor: events[2].id });
    expect(collection.docs.size).toBe(3);
    expect(persistedRows()).toStrictEqual(first);
    expect(persistedRows()).toStrictEqual(goldenRows);
  });
});
