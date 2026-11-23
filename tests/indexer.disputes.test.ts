import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { CHAIN_EVENT_NAMES } from '../src/shared/types/chain.js';
import { MilestoneEvent } from '../src/shared/constants/index.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import { createMockPayment } from './fixtures/factories.js';

const ledgerUpdateOneMock = jest.fn();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    updateOne: ledgerUpdateOneMock,
  },
}));

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const REASON_HASH = 'c3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c00d';
const RESOLVE_OUTCOME = 'refund_payer';

function adapterStreaming(events: ChainEvent[]): ChainAdapter {
  return {
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

describe('indexer dispute events — raise → resolve fixture paths', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockReset();
    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });
  });

  it('raises a dispute and stores the reason hash (no free-text parsing)', async () => {
    const payment = createMockPayment();
    const dispute: ChainEvent = {
      id: 'evt-dispute-1',
      contract_id: CONTRACT_ID,
      tx_hash: '11'.repeat(32),
      ledger: 200,
      ledger_closed_at: '2026-09-27T11:00:00Z',
      name: CHAIN_EVENT_NAMES.ESCROW_DISPUTE,
      topic: [CHAIN_EVENT_NAMES.ESCROW_DISPUTE, payment._id],
      data: [REASON_HASH],
    };

    const result = await indexStellarTransactions(adapterStreaming([dispute]));

    expect(result.processed).toBe(1);
    expect(result.upserted).toBe(1);

    const set = nthSet(0);
    expect(set.milestoneEvent).toBe(MilestoneEvent.DISPUTED);
    expect(set.metadata.paymentId).toBe(payment._id);
    expect(set.metadata.reasonHash).toBe(REASON_HASH);
    // Reason hash is stored verbatim — never parsed as free text.
    expect(set.metadata.reason).toBeUndefined();
    expect(set.metadata.description).toBeUndefined();
    expect(set.metadata.disputeReason).toBeUndefined();
  });

  it('resolves a dispute and reflects the outcome from chain data (not inferred)', async () => {
    const payment = createMockPayment();
    const resolve: ChainEvent = {
      id: 'evt-resolve-1',
      contract_id: CONTRACT_ID,
      tx_hash: '22'.repeat(32),
      ledger: 201,
      ledger_closed_at: '2026-09-27T11:05:00Z',
      name: CHAIN_EVENT_NAMES.ESCROW_RESOLVE,
      topic: [CHAIN_EVENT_NAMES.ESCROW_RESOLVE, payment._id],
      data: [RESOLVE_OUTCOME],
    };

    const result = await indexStellarTransactions(adapterStreaming([resolve]));

    expect(result.processed).toBe(1);

    const set = nthSet(0);
    expect(set.milestoneEvent).toBe(MilestoneEvent.RESOLVED);
    expect(set.metadata.paymentId).toBe(payment._id);
    expect(set.metadata.outcome).toBe(RESOLVE_OUTCOME);
    // Outcome is reflected from chain data, not inferred from status.
    expect(set.metadata.inferredOutcome).toBeUndefined();
  });

  it('freezes escrow state on esc_freeze event', async () => {
    const payment = createMockPayment();
    const freeze: ChainEvent = {
      id: 'evt-freeze-1',
      contract_id: CONTRACT_ID,
      tx_hash: '33'.repeat(32),
      ledger: 202,
      ledger_closed_at: '2026-09-27T11:10:00Z',
      name: CHAIN_EVENT_NAMES.ESCROW_FREEZE,
      topic: [CHAIN_EVENT_NAMES.ESCROW_FREEZE, payment._id],
      data: [],
    };

    const result = await indexStellarTransactions(adapterStreaming([freeze]));

    expect(result.processed).toBe(1);

    const set = nthSet(0);
    expect(set.milestoneEvent).toBe(MilestoneEvent.ESCROW_FROZEN);
    expect(set.metadata.paymentId).toBe(payment._id);
    expect(set.metadata.frozen).toBe(true);
  });

  it('unfreezes escrow state on esc_unfreeze event', async () => {
    const payment = createMockPayment();
    const unfreeze: ChainEvent = {
      id: 'evt-unfreeze-1',
      contract_id: CONTRACT_ID,
      tx_hash: '44'.repeat(32),
      ledger: 203,
      ledger_closed_at: '2026-09-27T11:15:00Z',
      name: CHAIN_EVENT_NAMES.ESCROW_UNFREEZE,
      topic: [CHAIN_EVENT_NAMES.ESCROW_UNFREEZE, payment._id],
      data: [],
    };

    const result = await indexStellarTransactions(adapterStreaming([unfreeze]));

    expect(result.processed).toBe(1);

    const set = nthSet(0);
    expect(set.milestoneEvent).toBe(MilestoneEvent.ESCROW_UNFROZEN);
    expect(set.metadata.paymentId).toBe(payment._id);
    expect(set.metadata.frozen).toBe(false);
  });

  it('raises → resolves → freezes → unfreezes in sequence, cursor advances', async () => {
    const payment = createMockPayment();
    const events: ChainEvent[] = [
      {
        id: 'evt-seq-1',
        contract_id: CONTRACT_ID,
        tx_hash: '51'.repeat(32),
        ledger: 210,
        ledger_closed_at: '2026-09-27T12:00:00Z',
        name: CHAIN_EVENT_NAMES.ESCROW_DISPUTE,
        topic: [CHAIN_EVENT_NAMES.ESCROW_DISPUTE, payment._id],
        data: [REASON_HASH],
      },
      {
        id: 'evt-seq-2',
        contract_id: CONTRACT_ID,
        tx_hash: '52'.repeat(32),
        ledger: 211,
        ledger_closed_at: '2026-09-27T12:01:00Z',
        name: CHAIN_EVENT_NAMES.ESCROW_RESOLVE,
        topic: [CHAIN_EVENT_NAMES.ESCROW_RESOLVE, payment._id],
        data: [RESOLVE_OUTCOME],
      },
      {
        id: 'evt-seq-3',
        contract_id: CONTRACT_ID,
        tx_hash: '53'.repeat(32),
        ledger: 212,
        ledger_closed_at: '2026-09-27T12:02:00Z',
        name: CHAIN_EVENT_NAMES.ESCROW_FREEZE,
        topic: [CHAIN_EVENT_NAMES.ESCROW_FREEZE, payment._id],
        data: [],
      },
      {
        id: 'evt-seq-4',
        contract_id: CONTRACT_ID,
        tx_hash: '54'.repeat(32),
        ledger: 213,
        ledger_closed_at: '2026-09-27T12:03:00Z',
        name: CHAIN_EVENT_NAMES.ESCROW_UNFREEZE,
        topic: [CHAIN_EVENT_NAMES.ESCROW_UNFREEZE, payment._id],
        data: [],
      },
    ];

    const result = await indexStellarTransactions(adapterStreaming(events));

    expect(result.processed).toBe(4);
    expect(result.upserted).toBe(4);
    expect(result.lastCursor).toBe('evt-seq-4');

    // Dispute raised with reason hash
    expect(nthSet(0).milestoneEvent).toBe(MilestoneEvent.DISPUTED);
    expect(nthSet(0).metadata.reasonHash).toBe(REASON_HASH);
    // Dispute resolved with chain-reflected outcome
    expect(nthSet(1).milestoneEvent).toBe(MilestoneEvent.RESOLVED);
    expect(nthSet(1).metadata.outcome).toBe(RESOLVE_OUTCOME);
    // Escrow frozen
    expect(nthSet(2).milestoneEvent).toBe(MilestoneEvent.ESCROW_FROZEN);
    expect(nthSet(2).metadata.frozen).toBe(true);
    // Escrow unfrozen
    expect(nthSet(3).milestoneEvent).toBe(MilestoneEvent.ESCROW_UNFROZEN);
    expect(nthSet(3).metadata.frozen).toBe(false);

    // All payments reference the same payment id
    for (let i = 0; i < 4; i += 1) {
      expect(nthSet(i).metadata.paymentId).toBe(payment._id);
    }
  });
});
