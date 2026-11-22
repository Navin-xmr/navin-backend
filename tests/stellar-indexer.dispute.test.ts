/**
 * #1036 — the indexer mirrors `dispute_resolved` outcomes into the Payment
 * projection. The resolution is taken from the chain event only: `resolved`
 * releases escrow, `rejected` unfreezes it back to Escrowed.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Types } from 'mongoose';
import { createPaymentModelMock, createSocketIoMock } from './helpers/mocks.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { CHAIN_EVENT_NAMES } from '../src/shared/types/chain.js';
import type { ChainEvent } from '../src/shared/types/chain.js';

const ledgerUpdateOneMock = jest.fn().mockResolvedValue({ upsertedCount: 1 });
const paymentUpdateOneMock = jest.fn().mockResolvedValue({ modifiedCount: 1 });
const paymentFindOneAndUpdateMock = jest.fn(() => ({ lean: async () => null }));
const paymentFindMock = jest.fn(() => ({ lean: async () => [] }));

const paymentModelMock = createPaymentModelMock({
  PaymentModel: {
    find: paymentFindMock,
    findOneAndUpdate: paymentFindOneAndUpdateMock,
    updateOne: paymentUpdateOneMock,
  },
});

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: { updateOne: ledgerUpdateOneMock },
}));
await jest.unstable_mockModule('../src/modules/payments/payments.model.js', () => paymentModelMock);
await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
  Telemetry: {
    findOneAndUpdate: jest.fn(),
    find: jest.fn(() => ({ lean: async () => [] })),
    updateOne: jest.fn(),
  },
  TelemetryAnchorStatus: { ANCHORED: 'ANCHORED', VERIFIED: 'VERIFIED' },
}));
await jest.unstable_mockModule('../src/infra/socket/io.js', () => createSocketIoMock());

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const SHIPMENT_ID = new Types.ObjectId().toString();
const CALLER = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';

function makeAdapter(events: ChainEvent[]): ChainAdapter {
  return {
    async anchorEvent() {
      throw new Error('not implemented');
    },
    async releaseEscrow() {
      throw new Error('not implemented');
    },
    async createShipment() {
      throw new Error('not implemented');
    },
    async raiseDispute() {
      throw new Error('not implemented');
    },
    async resolveDispute() {
      throw new Error('not implemented');
    },
    async addCompany() {
      throw new Error('not implemented');
    },
    async addCarrier() {
      throw new Error('not implemented');
    },
    async addCarrierToWhitelist() {
      throw new Error('not implemented');
    },
    async preflightRole() {
      return { allowed: true };
    },
    async *streamEvents() {
      yield* events;
    },
    async getConfirmationCount() {
      return 3;
    },
  };
}

function disputeResolvedEvent(outcome: 'resolved' | 'rejected'): ChainEvent {
  return {
    id: 'evt-dispute-resolved',
    contract_id: CONTRACT_ID,
    tx_hash: 'aa'.repeat(32),
    ledger: 900,
    ledger_closed_at: '2026-09-27T12:00:00.000Z',
    name: CHAIN_EVENT_NAMES.DISPUTE_RESOLVED,
    topic: [CHAIN_EVENT_NAMES.DISPUTE_RESOLVED, SHIPMENT_ID],
    data: [outcome, CALLER],
  };
}

describe('stellar indexer — dispute_resolved mirrors outcome from chain (#1036)', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockClear();
    paymentUpdateOneMock.mockClear();
  });

  it('releases escrow and unfreezes when the outcome is "resolved"', async () => {
    await indexStellarTransactions(makeAdapter([disputeResolvedEvent('resolved')]));

    expect(paymentUpdateOneMock).toHaveBeenCalledWith(
      { shipmentId: expect.any(Types.ObjectId), status: 'Disputed' },
      {
        $set: expect.objectContaining({
          status: 'Released',
          escrowFrozen: false,
          'escrowRelease.disputeOutcome': 'resolved',
        }),
      }
    );
  });

  it('unfreezes back to Escrowed when the outcome is "rejected"', async () => {
    await indexStellarTransactions(makeAdapter([disputeResolvedEvent('rejected')]));

    expect(paymentUpdateOneMock).toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({
        status: 'Escrowed',
        escrowFrozen: false,
        'escrowRelease.disputeOutcome': 'rejected',
      }),
    });
  });

  it('also upserts a DISPUTE_RESOLVED ledger block entry', async () => {
    await indexStellarTransactions(makeAdapter([disputeResolvedEvent('resolved')]));

    expect(ledgerUpdateOneMock).toHaveBeenCalledWith(
      { transactionHash: 'aa'.repeat(32) },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ milestoneEvent: 'DISPUTE_RESOLVED' }),
      }),
      { upsert: true }
    );
  });
});
