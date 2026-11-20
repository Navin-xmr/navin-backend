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

type Row = Record<string, unknown>;
const store = new Map<string, Row>();

const ledgerUpdateOneMock = jest.fn(
  async (
    filter: { transactionHash: string },
    update: { $setOnInsert?: Row; $set?: Row }
  ): Promise<{ upsertedCount: number }> => {
    const prior = store.get(filter.transactionHash);
    const { indexedAt: _ignored, ...rest } = ((update.$set?.metadata as Row) ?? {}) as Row;
    void _ignored;
    store.set(filter.transactionHash, {
      ...(prior ?? update.$setOnInsert),
      ...update.$set,
      metadata: rest,
    });
    return { upsertedCount: prior ? 0 : 1 };
  }
);
const ledgerExistsMock = jest.fn(async (filter: { transactionHash: string }) =>
  store.has(filter.transactionHash) ? { _id: 'x' } : null
);

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

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
    exists: ledgerExistsMock,
    find: () => ({ lean: async () => [] }),
  },
}));
await jest.unstable_mockModule('../src/modules/payments/payments.model.js', () => paymentModelMock);
await jest.unstable_mockModule(
  '../src/modules/telemetry/telemetry.model.js',
  () => telemetryModelMock
);
await jest.unstable_mockModule('../src/infra/socket/io.js', () => createSocketIoMock());

const { runReplay, parseReplayArgs } = await import('../src/scripts/chainReplay.js');

const fixture = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/chain/events.json'), 'utf8')
);
const events: ChainEvent[] = [
  fixture.events.anchor,
  fixture.events.esc_init,
  fixture.events.esc_rel,
];

const seenCursors: Array<string | undefined> = [];
const adapter: ChainAdapter = {
  async anchorEvent() {
    throw new Error('not used');
  },
  async releaseEscrow() {
    throw new Error('not used');
  },
  async *streamEvents(cursor?: string) {
    seenCursors.push(cursor);
    for (const ev of events) yield ev;
  },
  async getConfirmationCount() {
    return 3;
  },
};

describe('chain:replay (#1063)', () => {
  beforeEach(() => {
    store.clear();
    seenCursors.length = 0;
    ledgerUpdateOneMock.mockClear();
  });

  it('parses --from and --dry-run', () => {
    expect(parseReplayArgs(['--from', '512345', '--dry-run'])).toEqual({
      from: '512345',
      dryRun: true,
    });
    expect(() => parseReplayArgs([])).toThrow(/Usage/);
    expect(() => parseReplayArgs(['--from'])).toThrow(/Usage/);
  });

  it('dry-run reports counts and writes nothing', async () => {
    const summary = await runReplay({ from: '512345', dryRun: true }, adapter);
    expect(summary).toMatchObject({ processed: 3, upserted: 3, existing: 0 });
    expect(ledgerUpdateOneMock).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(seenCursors).toEqual(['512345']);
  });

  it('replaying the fixture twice yields identical final state', async () => {
    await runReplay({ from: '512345', dryRun: false }, adapter);
    const afterFirst = JSON.stringify([...store.entries()]);
    const second = await runReplay({ from: '512345', dryRun: false }, adapter);
    expect(second.upserted).toBe(0);
    expect(JSON.stringify([...store.entries()])).toBe(afterFirst);
    expect(store.size).toBe(3);

    const dry = await runReplay({ from: '512345', dryRun: true }, adapter);
    expect(dry).toMatchObject({ upserted: 0, existing: 3 });
  });
});
