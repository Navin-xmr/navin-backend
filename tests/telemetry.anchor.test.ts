/**
 * #972 — Telemetry anchor VERIFIED transition tests.
 *
 * Verifies that:
 * 1. Telemetry documents with anchorStatus ANCHORED and a matching stellarTxHash
 *    are promoted to TelemetryAnchorStatus.VERIFIED once the confirmation count
 *    reaches the configured threshold.
 * 2. Documents that do not match the filter (wrong hash or already VERIFIED) are
 *    never modified.
 *
 * ESM mock order: jest.resetModules() → jest.unstable_mockModule() → dynamic import.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createChainAdapterMock,
  createChainFactoryMock,
  createPaymentModelMock,
  createSocketIoMock,
  createTelemetryModelMock,
} from './helpers/mocks.js';
import { CHAIN_EVENT_NAMES } from '../src/shared/types/chain.js';
import { TelemetryAnchorStatus } from '../src/shared/types/telemetry.js';
import { createMockTelemetry } from './fixtures/factories.js';
import type { ChainEvent } from '../src/shared/types/chain.js';

// ---------------------------------------------------------------------------
// Module-scope mock instances — wired once, reset per-test in beforeEach.
// ---------------------------------------------------------------------------

const ledgerUpdateOneMock = jest.fn();
const telemetryFindOneAndUpdateMock = jest.fn((): { lean: () => Promise<unknown> } => ({
  lean: async () => null,
}));
const telemetryUpdateOneMock = jest.fn();
const telemetryFindMock = jest.fn((): { lean: () => Promise<unknown[]> } => ({
  lean: async () => [],
}));

const telemetryModelMock = createTelemetryModelMock({
  Telemetry: {
    findOneAndUpdate: telemetryFindOneAndUpdateMock,
    updateOne: telemetryUpdateOneMock,
    find: telemetryFindMock,
  },
});

const paymentModelMock = createPaymentModelMock();
const socketIoMock = createSocketIoMock();

jest.resetModules();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: { updateOne: ledgerUpdateOneMock },
}));
await jest.unstable_mockModule(
  '../src/modules/telemetry/telemetry.model.js',
  () => telemetryModelMock
);
await jest.unstable_mockModule('../src/modules/payments/payments.model.js', () => paymentModelMock);
await jest.unstable_mockModule('../src/infra/socket/io.js', () => socketIoMock);

const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';

function makeAnchorAdapter(events: ChainEvent[], confirmations: number) {
  return {
    async anchorEvent(): Promise<never> {
      throw new Error('not implemented');
    },
    async releaseEscrow(): Promise<never> {
      throw new Error('not implemented');
    },
    async *streamEvents() {
      yield* events;
    },
    async getConfirmationCount() {
      return confirmations;
    },
  };
}

function anchorEvent(txHash: string, shipmentId: string, ledger = 100): ChainEvent {
  return {
    id: `evt-${txHash.slice(0, 8)}`,
    contract_id: CONTRACT_ID,
    tx_hash: txHash,
    ledger,
    ledger_closed_at: '2026-09-27T10:00:00Z',
    name: CHAIN_EVENT_NAMES.ANCHOR,
    topic: [CHAIN_EVENT_NAMES.ANCHOR, shipmentId],
    data: ['a'.repeat(64), ledger],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Telemetry anchor VERIFIED transition (#972)', () => {
  beforeEach(() => {
    ledgerUpdateOneMock.mockReset();
    ledgerUpdateOneMock.mockResolvedValue({ upsertedCount: 1 });
    telemetryFindOneAndUpdateMock.mockReset();
    telemetryFindOneAndUpdateMock.mockImplementation(() => ({ lean: async () => null }));
    telemetryUpdateOneMock.mockReset();
    telemetryFindMock.mockReset();
    telemetryFindMock.mockImplementation(() => ({ lean: async () => [] }));
  });

  // ── Acceptance criterion 1: ANCHORED → VERIFIED transition ─────────────────

  describe('ANCHORED → VERIFIED promotion', () => {
    it('calls findOneAndUpdate with anchorStatus VERIFIED once confirmations reach threshold', async () => {
      const telemetry = createMockTelemetry();
      const event = anchorEvent(telemetry.stellarTxHash!, telemetry.shipmentId);

      telemetryFindOneAndUpdateMock.mockImplementationOnce(() => ({
        lean: async () => ({ _id: { toString: () => telemetry._id } }),
      }));

      await indexStellarTransactions(makeAnchorAdapter([event], 3));

      expect(telemetryFindOneAndUpdateMock).toHaveBeenCalledWith(
        {
          stellarTxHash: telemetry.stellarTxHash,
          anchorStatus: TelemetryAnchorStatus.ANCHORED,
        },
        {
          $set: expect.objectContaining({
            anchorStatus: TelemetryAnchorStatus.VERIFIED,
            verified: true,
          }),
        },
        { new: true }
      );
    });

    it('sets verified: true and anchorStatus: VERIFIED in the $set payload', async () => {
      const telemetry = createMockTelemetry();
      const event = anchorEvent(telemetry.stellarTxHash!, telemetry.shipmentId);

      telemetryFindOneAndUpdateMock.mockImplementationOnce(() => ({
        lean: async () => ({ _id: { toString: () => telemetry._id } }),
      }));

      await indexStellarTransactions(makeAnchorAdapter([event], 3));

      const [[, update]] = telemetryFindOneAndUpdateMock.mock.calls as [
        [unknown, { $set: Record<string, unknown> }, unknown],
        ...unknown[]
      ][];
      expect(update.$set.anchorStatus).toBe(TelemetryAnchorStatus.VERIFIED);
      expect(update.$set.verified).toBe(true);
    });

    it('records confirmationMetadata.verified = true at threshold', async () => {
      const telemetry = createMockTelemetry();
      const event = anchorEvent(telemetry.stellarTxHash!, telemetry.shipmentId);

      telemetryFindOneAndUpdateMock.mockImplementationOnce(() => ({
        lean: async () => ({ _id: { toString: () => telemetry._id } }),
      }));

      await indexStellarTransactions(makeAnchorAdapter([event], 3));

      const [[, update]] = telemetryFindOneAndUpdateMock.mock.calls as [
        [unknown, { $set: { confirmationMetadata: Record<string, unknown> } }, unknown],
        ...unknown[]
      ][];
      expect(update.$set.confirmationMetadata).toMatchObject({
        confirmations: 3,
        verified: true,
      });
    });
  });

  // ── Acceptance criterion 1 (sub): below threshold keeps ANCHORED ───────────

  describe('below-threshold behaviour', () => {
    it('calls updateOne (not findOneAndUpdate) when confirmations < threshold', async () => {
      const telemetry = createMockTelemetry();
      const event = anchorEvent(telemetry.stellarTxHash!, telemetry.shipmentId);

      await indexStellarTransactions(makeAnchorAdapter([event], 2));

      expect(telemetryUpdateOneMock).toHaveBeenCalledWith(
        {
          stellarTxHash: telemetry.stellarTxHash,
          anchorStatus: TelemetryAnchorStatus.ANCHORED,
        },
        {
          $set: expect.objectContaining({
            confirmationMetadata: expect.objectContaining({ confirmations: 2 }),
          }),
        }
      );
      expect(telemetryFindOneAndUpdateMock).not.toHaveBeenCalled();
    });

    it('does not set anchorStatus in the updateOne $set when below threshold', async () => {
      const telemetry = createMockTelemetry();
      const event = anchorEvent(telemetry.stellarTxHash!, telemetry.shipmentId);

      await indexStellarTransactions(makeAnchorAdapter([event], 1));

      const [[, update]] = telemetryUpdateOneMock.mock.calls as [
        [unknown, { $set: Record<string, unknown> }],
        ...unknown[]
      ][];
      expect(update.$set).not.toHaveProperty('anchorStatus');
      expect(update.$set).not.toHaveProperty('verified');
    });

    it('two-phase: updateOne at 2 confirmations, then findOneAndUpdate at 3', async () => {
      const telemetry = createMockTelemetry();
      const event = anchorEvent(telemetry.stellarTxHash!, telemetry.shipmentId);

      // Phase 1 — below threshold
      await indexStellarTransactions(makeAnchorAdapter([event], 2));
      expect(telemetryUpdateOneMock).toHaveBeenCalledTimes(1);
      expect(telemetryFindOneAndUpdateMock).not.toHaveBeenCalled();

      telemetryUpdateOneMock.mockClear();

      // Phase 2 — at threshold
      telemetryFindOneAndUpdateMock.mockImplementationOnce(() => ({
        lean: async () => ({ _id: { toString: () => telemetry._id } }),
      }));
      await indexStellarTransactions(makeAnchorAdapter([event], 3));
      expect(telemetryFindOneAndUpdateMock).toHaveBeenCalledTimes(1);
      expect(telemetryUpdateOneMock).not.toHaveBeenCalled();
    });
  });

  // ── Acceptance criterion 2: unmatched records are not modified ─────────────

  describe('unmatched telemetry records are not modified', () => {
    it('does not touch records with a different stellarTxHash', async () => {
      const targetTelemetry = createMockTelemetry();
      const unrelatedTxHash = 'b'.repeat(64);

      // Event arrives for targetTelemetry; unrelatedTxHash record must not be touched.
      const event = anchorEvent(targetTelemetry.stellarTxHash!, targetTelemetry.shipmentId);

      telemetryFindOneAndUpdateMock.mockImplementationOnce(() => ({
        lean: async () => ({ _id: { toString: () => targetTelemetry._id } }),
      }));

      await indexStellarTransactions(makeAnchorAdapter([event], 3));

      // Every call must have used the correct target hash — never the unrelated one.
      for (const call of telemetryFindOneAndUpdateMock.mock.calls) {
        const filter = (call as [Record<string, unknown>, ...unknown[]])[0];
        expect(filter.stellarTxHash).not.toBe(unrelatedTxHash);
      }
      for (const call of telemetryUpdateOneMock.mock.calls) {
        const filter = (call as [Record<string, unknown>, ...unknown[]])[0];
        expect(filter.stellarTxHash).not.toBe(unrelatedTxHash);
      }
    });

    it('filter always targets ANCHORED status — never queries other statuses', async () => {
      const telemetry = createMockTelemetry();
      const event = anchorEvent(telemetry.stellarTxHash!, telemetry.shipmentId);

      telemetryFindOneAndUpdateMock.mockImplementationOnce(() => ({
        lean: async () => ({ _id: { toString: () => telemetry._id } }),
      }));

      await indexStellarTransactions(makeAnchorAdapter([event], 3));

      const [[filter]] = telemetryFindOneAndUpdateMock.mock.calls as [
        [Record<string, unknown>, ...unknown[]],
        ...unknown[]
      ][];
      expect(filter.anchorStatus).toBe(TelemetryAnchorStatus.ANCHORED);
    });

    it('no Telemetry write occurs when no anchor events are streamed', async () => {
      // Stream is empty — zero anchor events processed.
      await indexStellarTransactions(makeAnchorAdapter([], 3));

      expect(telemetryFindOneAndUpdateMock).not.toHaveBeenCalled();
      expect(telemetryUpdateOneMock).not.toHaveBeenCalled();
    });

    it('non-anchor events do not trigger Telemetry confirmation writes', async () => {
      // An esc_rel event must not touch Telemetry.
      const escRelEvent: ChainEvent = {
        id: 'evt-escrel',
        contract_id: CONTRACT_ID,
        tx_hash: 'cc'.repeat(32),
        ledger: 101,
        ledger_closed_at: '2026-09-27T11:00:00Z',
        name: CHAIN_EVENT_NAMES.ESCROW_RELEASE,
        topic: [CHAIN_EVENT_NAMES.ESCROW_RELEASE, 'aaaaaaaaaaaaaaaaaaaaaaaa'],
        data: ['a'.repeat(64), 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H', '1500000000'],
      };

      await indexStellarTransactions(makeAnchorAdapter([escRelEvent], 3));

      expect(telemetryFindOneAndUpdateMock).not.toHaveBeenCalled();
      expect(telemetryUpdateOneMock).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles multiple anchor events independently', async () => {
      const t1 = createMockTelemetry();
      const t2 = createMockTelemetry();
      const e1 = anchorEvent(t1.stellarTxHash!, t1.shipmentId, 100);
      const e2 = anchorEvent(t2.stellarTxHash!, t2.shipmentId, 101);

      telemetryFindOneAndUpdateMock
        .mockImplementationOnce(() => ({
          lean: async () => ({ _id: { toString: () => t1._id } }),
        }))
        .mockImplementationOnce(() => ({
          lean: async () => ({ _id: { toString: () => t2._id } }),
        }));

      await indexStellarTransactions(makeAnchorAdapter([e1, e2], 3));

      expect(telemetryFindOneAndUpdateMock).toHaveBeenCalledTimes(2);

      const hashes = (
        telemetryFindOneAndUpdateMock.mock.calls as [Record<string, unknown>, ...unknown[]][]
      ).map(([filter]) => filter.stellarTxHash);
      expect(hashes).toContain(t1.stellarTxHash);
      expect(hashes).toContain(t2.stellarTxHash);
    });
  });
});
