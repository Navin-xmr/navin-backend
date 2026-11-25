import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

import {
  createPaymentModelMock,
  createSocketIoMock,
  createTelemetryModelMock,
} from './helpers/mocks.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { CHAIN_EVENT_NAMES } from '../src/shared/types/chain.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import { MilestoneEvent } from '../src/shared/constants/index.js';

const ledgerUpdateOneMock = jest.fn();
const paymentModelMock = createPaymentModelMock();
const telemetryModelMock = createTelemetryModelMock({
  Telemetry: { find: jest.fn(() => ({ lean: async () => [] })) },
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

const fixtureData = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/chain/events.json'), 'utf8')
) as { events: Record<string, ChainEvent> };

const raised = fixtureData.events.dispute_raised!;
const frozen = fixtureData.events.escrow_frozen!;
const resolved = fixtureData.events.dispute_resolved!;

function adapterStreaming(events: ChainEvent[]): ChainAdapter {
  return {
    async anchorEvent() {
      throw new Error('Not implemented');
    },
    async releaseEscrow() {
      throw new Error('Not implemented');
    },
    async updateStatus() {
      throw new Error('Not implemented');
    },
    async *streamEvents() {
      yield* events;
    },
    async getConfirmationCount() {
      return 3;
    },
  };
}

/** The `$set` stage of the n-th (0-based) LedgerBlock update. */
function nthSet(n: number): Record<string, unknown> {
  const [, update] = ledgerUpdateOneMock.mock.calls[n] as [
    unknown,
    { $set: Record<string, unknown> },
  ];
  return update.$set;
}

describe('indexer dispute events — raise → resolve fixture paths (#1053)', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockReset();
  });

  it('opens the dispute record with the reason hash, then merges the co-emitted freeze', async () => {
    // `raise_dispute` emits dispute_raised AND escrow_frozen in one transaction,
    // so both fixture events share a tx_hash.
    expect(raised.tx_hash).toBe(frozen.tx_hash);
    expect(raised.name).toBe(CHAIN_EVENT_NAMES.DISPUTE_RAISED);
    expect(frozen.name).toBe(CHAIN_EVENT_NAMES.ESCROW_FROZEN);

    ledgerUpdateOneMock.mockResolvedValueOnce({ upsertedCount: 1, matchedCount: 0 });
    ledgerUpdateOneMock.mockResolvedValueOnce({ matchedCount: 1 });

    const summary = await indexStellarTransactions(adapterStreaming([raised, frozen]));

    expect(summary.processed).toBe(2);
    expect(summary.upserted).toBe(1);

    // 1. dispute_raised opens the record and stores the hash verbatim.
    const openSet = nthSet(0);
    expect(openSet.milestoneEvent).toBe(MilestoneEvent.DISPUTED);
    const openMetadata = openSet.metadata as Record<string, unknown>;
    expect(openMetadata.disputeState).toBe('OPEN');
    expect(openMetadata.reasonHash).toBe(raised.data[2]);
    expect(openMetadata.raisedBy).toBe(raised.data[1]);
    // Reason hashes are stored verbatim — never parsed as free text.
    expect(openMetadata.reason).toBeUndefined();
    expect(openMetadata.description).toBeUndefined();
    expect(openMetadata.disputeReason).toBeUndefined();

    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      1,
      { transactionHash: raised.tx_hash },
      expect.any(Object),
      {
        upsert: true,
      }
    );

    // 2. escrow_frozen merges freeze state into that same row (same tx_hash):
    // dotted paths only, so the DISPUTED milestone and reason hash survive.
    const freezeSet = nthSet(1);
    expect(freezeSet).toMatchObject({
      'metadata.escrowFrozen': true,
      'metadata.escrowFreezeReason': frozen.data[1],
      'metadata.frozenBy': frozen.data[2],
      'metadata.frozenAt': frozen.data[3],
    });
    expect(freezeSet.milestoneEvent).toBeUndefined();
    expect(freezeSet.metadata).toBeUndefined();
    expect(ledgerUpdateOneMock).toHaveBeenNthCalledWith(
      2,
      { transactionHash: frozen.tx_hash },
      expect.any(Object)
    );
  });

  it('closes the dispute record with the contract resolution reflected verbatim', async () => {
    ledgerUpdateOneMock.mockResolvedValueOnce({ upsertedCount: 1, matchedCount: 0 });

    const summary = await indexStellarTransactions(adapterStreaming([resolved]));

    expect(summary.processed).toBe(1);
    expect(summary.upserted).toBe(1);

    const set = nthSet(0);
    expect(set.milestoneEvent).toBe(MilestoneEvent.RESOLVED);
    const metadata = set.metadata as Record<string, unknown>;
    expect(metadata.disputeState).toBe('CLOSED');
    expect(metadata.resolution).toBe('RefundToCompany');
    expect(metadata.reasonHash).toBe(resolved.data[2]);
    expect(metadata.resolvedBy).toBe(resolved.data[3]);
    // Resolution clears the freeze; there is no separate unfreeze event.
    expect(metadata.escrowFrozen).toBe(false);
    // Outcome is reflected from chain data, not inferred from status.
    expect(metadata.inferredOutcome).toBeUndefined();
  });

  it('replays raise → resolve in ledger order and advances the cursor', async () => {
    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1, matchedCount: 1 });

    const summary = await indexStellarTransactions(adapterStreaming([raised, resolved]));

    expect(summary.processed).toBe(2);
    expect(summary.lastCursor).toBe(resolved.id);
    expect(nthSet(0).milestoneEvent).toBe(MilestoneEvent.DISPUTED);
    expect(nthSet(1).milestoneEvent).toBe(MilestoneEvent.RESOLVED);
    expect((nthSet(0).metadata as Record<string, unknown>).reasonHash).toBe(raised.data[2]);
    expect((nthSet(1).metadata as Record<string, unknown>).resolution).toBe('RefundToCompany');
  });

  it('records a standalone freeze (suspension/pause) as its own projection row', async () => {
    ledgerUpdateOneMock.mockResolvedValueOnce({ matchedCount: 0 });
    ledgerUpdateOneMock.mockResolvedValueOnce({ upsertedCount: 1 });

    const summary = await indexStellarTransactions(adapterStreaming([frozen]));

    expect(summary.processed).toBe(1);
    expect(summary.upserted).toBe(1);

    // The merge attempt matched nothing, so a dedicated freeze row is upserted.
    expect(nthSet(0)).toMatchObject({
      'metadata.escrowFrozen': true,
      'metadata.escrowFreezeReason': frozen.data[1],
    });
    const rowSet = nthSet(1);
    expect(rowSet.milestoneEvent).toBe(MilestoneEvent.ESCROW_FROZEN);
    expect(rowSet.metadata).toMatchObject({
      eventName: CHAIN_EVENT_NAMES.ESCROW_FROZEN,
      escrowFrozen: true,
      escrowFreezeReason: 'DisputeRaised',
      frozenBy: frozen.data[2],
      frozenAt: frozen.data[3],
    });
  });
});
