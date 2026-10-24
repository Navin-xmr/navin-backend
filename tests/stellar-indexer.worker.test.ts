import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import {
  createPaymentModelMock,
  createSocketIoMock,
  createTelemetryModelMock,
} from './helpers/mocks.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { CHAIN_EVENT_NAMES } from '../src/shared/types/chain.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import { createMockPayment, createMockShipment } from './fixtures/factories.js';

const ledgerUpdateOneMock = jest.fn();
const paymentFindOneAndUpdateMock = jest.fn((): { lean: () => Promise<unknown> } => ({
  lean: async () => null,
}));
const paymentFindMock = jest.fn((): { lean: () => Promise<unknown[]> } => ({
  lean: async () => [],
}));
const telemetryFindOneAndUpdateMock = jest.fn((): { lean: () => Promise<unknown> } => ({
  lean: async () => null,
}));
const telemetryFindMock = jest.fn((): { lean: () => Promise<unknown[]> } => ({
  lean: async () => [],
}));
const telemetryUpdateOneMock = jest.fn();
const emitPaymentStatusChangeMock = jest.fn();
const paymentModelMock = createPaymentModelMock({
  PaymentModel: {
    findOneAndUpdate: paymentFindOneAndUpdateMock,
    find: paymentFindMock,
  },
});
const telemetryModelMock = createTelemetryModelMock({
  Telemetry: {
    findOneAndUpdate: telemetryFindOneAndUpdateMock,
    find: telemetryFindMock,
    updateOne: telemetryUpdateOneMock,
  },
});
const socketIoMock = createSocketIoMock({
  emitPaymentStatusChange: emitPaymentStatusChangeMock,
});

jest.resetModules();

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
    paymentFindOneAndUpdateMock.mockReset();
    paymentFindOneAndUpdateMock.mockImplementation(() => ({ lean: async () => null }));
    paymentFindMock.mockReset();
    paymentFindMock.mockImplementation(() => ({ lean: async () => [] }));
    telemetryFindOneAndUpdateMock.mockReset();
    telemetryFindOneAndUpdateMock.mockImplementation(() => ({ lean: async () => null }));
    telemetryFindMock.mockClear();
    telemetryUpdateOneMock.mockClear();
    emitPaymentStatusChangeMock.mockClear();
  });

  const makeAdapter = (events: ChainEvent[], confirmations = 3): ChainAdapter => ({
    async anchorEvent() {
      throw new Error('Not implemented');
    },
    async releaseEscrow() {
      throw new Error('Not implemented');
    },
    async *streamEvents() {
      yield* events;
    },
    async getConfirmationCount() {
      return confirmations;
    },
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

    const result = await indexStellarTransactions(makeAdapter(mockEvents));

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

    // Tightened field assertions (#970): milestoneEvent (never legacy eventType)
    // in both operators, and top-level dataHash matching the event hash.
    const [, anchorUpdate] = ledgerUpdateOneMock.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> },
    ];
    expect(anchorUpdate.$setOnInsert.milestoneEvent).toBe('IN_TRANSIT');
    expect(anchorUpdate.$setOnInsert).not.toHaveProperty('eventType');
    expect(anchorUpdate.$set.milestoneEvent).toBe('IN_TRANSIT');
    expect(anchorUpdate.$set).not.toHaveProperty('eventType');
    expect(anchorUpdate.$set.dataHash).toBe(mockEvents[0].data[0]);
    expect(anchorUpdate.$set.dataHash).toBe('a'.repeat(64));
  });

  it('writes milestoneEvent (not eventType) with no top-level dataHash for esc_init', async () => {
    const initEvent: ChainEvent = {
      id: 'evt-init-1',
      contract_id: CONTRACT_ID,
      tx_hash: '44'.repeat(32),
      ledger: 101,
      ledger_closed_at: '2026-09-27T10:00:00Z',
      name: 'esc_init',
      topic: ['esc_init', '66a0b1c2d3e4f50617283940'],
      data: [
        '65f1a2b3c4d5e6f708192a3b',
        PAYEE,
        'GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA',
        CONTRACT_ID,
        '1500000000',
      ],
    };

    await indexStellarTransactions(makeAdapter([initEvent]));

    const [, update] = ledgerUpdateOneMock.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> },
    ];
    expect(update.$setOnInsert.milestoneEvent).toBe('SETTLEMENT_INITIATED');
    expect(update.$setOnInsert).not.toHaveProperty('eventType');
    expect(update.$set.milestoneEvent).toBe('SETTLEMENT_INITIATED');
    expect(update.$set).not.toHaveProperty('eventType');
    expect(update.$set).not.toHaveProperty('dataHash');
  });

  it('verifies anchored telemetry only after three ledger confirmations', async () => {
    const anchorEvent: ChainEvent = {
      id: 'evt-anchor',
      contract_id: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
      tx_hash: '22'.repeat(32),
      ledger: 100,
      ledger_closed_at: '2026-09-27T10:00:00Z',
      name: 'anchor',
      topic: ['anchor', 'ship-1'],
      data: ['a'.repeat(64), 100],
    };

    await indexStellarTransactions(makeAdapter([anchorEvent], 2));
    expect(telemetryUpdateOneMock).toHaveBeenCalledWith(
      { stellarTxHash: anchorEvent.tx_hash, anchorStatus: 'ANCHORED' },
      {
        $set: {
          stellarTxLedger: 100,
          confirmationMetadata: expect.objectContaining({ ledger: 100, confirmations: 2 }),
        },
      }
    );
    expect(telemetryFindOneAndUpdateMock).not.toHaveBeenCalled();

    telemetryFindOneAndUpdateMock.mockImplementationOnce(() => ({
      lean: async () => ({ _id: { toString: () => 'telemetry-1' } }),
    }));
    await indexStellarTransactions(makeAdapter([anchorEvent], 3));
    expect(telemetryFindOneAndUpdateMock).toHaveBeenCalledWith(
      { stellarTxHash: anchorEvent.tx_hash, anchorStatus: 'ANCHORED' },
      {
        $set: expect.objectContaining({
          anchorStatus: 'VERIFIED',
          verified: true,
          stellarTxLedger: 100,
          confirmationMetadata: expect.objectContaining({ confirmations: 3, verified: true }),
        }),
      },
      { new: true }
    );
  });

  it('emits settlement status only at three confirmations', async () => {
    const releaseEvent: ChainEvent = {
      id: 'evt-release',
      contract_id: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
      tx_hash: '33'.repeat(32),
      ledger: 100,
      ledger_closed_at: '2026-09-27T10:00:00Z',
      name: 'esc_rel',
      topic: ['esc_rel', '66a0b1c2d3e4f50617283940'],
      data: ['a'.repeat(64), Keypair.random().publicKey(), '1500000000'],
    };
    const payment = {
      _id: { toString: () => '66a0b1c2d3e4f50617283940' },
      shipmentId: { toString: () => '65f1a2b3c4d5e6f708192a3b' },
      status: 'Released',
      amount: 15,
      stellarTxHash: releaseEvent.tx_hash,
      stellarTxLedger: 100,
    };

    paymentFindOneAndUpdateMock.mockImplementation(() => ({
      lean: async () => payment,
    }));
    await indexStellarTransactions(makeAdapter([releaseEvent], 2));
    expect(emitPaymentStatusChangeMock).not.toHaveBeenCalled();

    await indexStellarTransactions(makeAdapter([releaseEvent], 3));
    expect(emitPaymentStatusChangeMock).toHaveBeenCalledWith(
      '65f1a2b3c4d5e6f708192a3b',
      expect.objectContaining({
        paymentId: '66a0b1c2d3e4f50617283940',
        newStatus: 'Released',
        txHash: releaseEvent.tx_hash,
      })
    );
  });
});
