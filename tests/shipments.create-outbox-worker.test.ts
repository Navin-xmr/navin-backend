/**
 * #997 — create_shipment outbox worker: success and chain-failure orderings.
 * No orphan states: every claimed row is either anchored or rescheduled/failed.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Types } from 'mongoose';

const findMock = jest.fn();
const leanMock = jest.fn();
const limitMock = jest.fn(() => ({ lean: leanMock }));
const updateOneMock = jest.fn<(...args: unknown[]) => Promise<{ matchedCount: number }>>();
const anchorEventMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const actorMock = jest.fn<() => string>();

jest.resetModules();

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    find: findMock,
    updateOne: updateOneMock,
  },
}));

await jest.unstable_mockModule('../src/services/chain/factory.js', () => ({
  getChainAdapter: () => ({ anchorEvent: anchorEventMock }),
  getChainActorAddress: actorMock,
}));

await jest.unstable_mockModule('../src/shared/logger/logger.js', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const { processCreateShipmentOutbox, retryDelayMs } = await import(
  '../src/workers/chainOutbox.worker.js'
);

const shipmentId = new Types.ObjectId();
const outbox = {
  status: 'pending_chain',
  idempotencyKey: '3a8f5d9e-1234-4abc-8def-0123456789ab',
  attempts: 0,
  availableAt: new Date(Date.now() - 1000),
};

function row() {
  return {
    _id: shipmentId,
    trackingNumber: 'NVN-123456',
    origin: 'Lagos',
    destination: 'Accra',
    chainOutbox: { ...outbox },
  };
}

describe('processCreateShipmentOutbox (#997)', () => {
  beforeEach(() => {
    findMock.mockReset();
    leanMock.mockReset();
    limitMock.mockReturnValue({ lean: leanMock });
    findMock.mockReturnValue({ limit: limitMock });
    updateOneMock.mockReset();
    updateOneMock.mockResolvedValue({ matchedCount: 1 });
    anchorEventMock.mockReset();
    actorMock.mockReset();
    actorMock.mockReturnValue('GTEST');
  });

  it('anchors a claimed row and records the u64 id as tx receipt + stellarTxHash', async () => {
    leanMock.mockResolvedValue([row()]);
    anchorEventMock.mockResolvedValue({ txHash: 'a'.repeat(64), ledger: 12, simulated: true });

    expect(await processCreateShipmentOutbox()).toBe(1);
    expect(anchorEventMock).toHaveBeenCalledTimes(1);
    expect(updateOneMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ 'chainOutbox.status': 'pending_chain' }),
      { $set: { 'chainOutbox.status': 'processing' } }
    );
    expect(updateOneMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ 'chainOutbox.idempotencyKey': outbox.idempotencyKey }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'chainOutbox.status': 'anchored',
          'chainOutbox.ledger': 12,
          stellarTxHash: 'a'.repeat(64),
        }),
      })
    );
  });

  it('reschedules a failed submission with backoff, keeping shipment + outbox intact', async () => {
    leanMock.mockResolvedValue([row()]);
    anchorEventMock.mockRejectedValue(new Error('chain unavailable'));

    expect(await processCreateShipmentOutbox()).toBe(1);
    expect(updateOneMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          'chainOutbox.status': 'pending_chain',
          'chainOutbox.attempts': 1,
          'chainOutbox.lastError': 'chain unavailable',
        }),
      })
    );
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(3)).toBe(8000);
  });

  it('marks the row failed after MAX_ATTEMPTS without deleting the shipment row', async () => {
    leanMock.mockResolvedValue([{ ...row(), chainOutbox: { ...outbox, attempts: 4 } }]);
    anchorEventMock.mockRejectedValue(new Error('chain unavailable'));

    expect(await processCreateShipmentOutbox()).toBe(1);
    expect(updateOneMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ 'chainOutbox.status': 'failed' }),
      })
    );
  });

  it('does not double-submit a row already claimed by another worker', async () => {
    leanMock.mockResolvedValue([row()]);
    updateOneMock.mockResolvedValue({ matchedCount: 0 });

    expect(await processCreateShipmentOutbox()).toBe(0);
    expect(anchorEventMock).not.toHaveBeenCalled();
  });
});
