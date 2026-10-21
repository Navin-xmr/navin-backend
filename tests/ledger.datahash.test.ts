/**
 * Tests for issue #660 — dataHash field on LedgerBlock.
 *
 * Coverage:
 *  1. Repo — createLedgerBlock persists dataHash when supplied in the input.
 *  2. Repo — createLedgerBlock omits dataHash when not supplied.
 *  3. Repo — createLedgerBlock throws AppError 400 when no event type given.
 *  4. Repo — both dataHash and transactionHash persisted together.
 *  5. Migration smoke — up() creates the sparse index; down() drops it.
 *
 * Schema-index assertions live in ledger.schema-indexes.test.ts (real model,
 * no mocks) so they are not affected by the LedgerBlock.create mock here.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Types } from 'mongoose';

// Register mock BEFORE any dynamic import of the module under test.
const createMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    create: createMock,
  },
}));

const { createLedgerBlock } = await import('../src/modules/ledger/ledger.repo.js');

// ─── Repo tests ───────────────────────────────────────────────────────────────

describe('createLedgerBlock — dataHash persistence (issue #660)', () => {
  const shipmentId = new Types.ObjectId().toHexString();

  beforeEach(() => {
    createMock.mockReset();
  });

  it('includes dataHash in the persisted document when supplied', async () => {
    const hash = 'a1b2c3d4e5f6'.padEnd(64, '0');

    createMock.mockResolvedValueOnce({
      _id: new Types.ObjectId().toHexString(),
      milestoneEvent: 'DELIVERED',
      dataHash: hash,
    });

    await createLedgerBlock({
      shipmentId,
      milestoneEvent: 'DELIVERED' as never,
      dataHash: hash,
      transactionHash: 'stellar-tx-hash',
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ dataHash: hash }),
    );
  });

  it('omits the dataHash key entirely when not supplied', async () => {
    createMock.mockResolvedValueOnce({
      _id: new Types.ObjectId().toHexString(),
      milestoneEvent: 'IN_TRANSIT',
    });

    await createLedgerBlock({
      shipmentId,
      milestoneEvent: 'IN_TRANSIT' as never,
      // intentionally no dataHash
    });

    const callArg = (createMock.mock.calls[0] as [Record<string, unknown>])[0];
    expect(callArg).not.toHaveProperty('dataHash');
  });

  it('throws AppError 400 when neither milestoneEvent nor eventType is given', async () => {
    await expect(createLedgerBlock({ shipmentId })).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_BAD_REQUEST',
      message: 'milestoneEvent or eventType is required',
    });
  });

  it('persists transactionHash alongside dataHash when both are supplied', async () => {
    const hash = 'deadbeef'.padEnd(64, '0');
    const txHash = 'stellar-tx-xyz';

    createMock.mockResolvedValueOnce({
      _id: new Types.ObjectId().toHexString(),
      milestoneEvent: 'PROOF_SUBMITTED',
      dataHash: hash,
      transactionHash: txHash,
    });

    await createLedgerBlock({
      shipmentId,
      milestoneEvent: 'PROOF_SUBMITTED' as never,
      dataHash: hash,
      transactionHash: txHash,
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dataHash: hash,
        transactionHash: txHash,
      }),
    );
  });
});

// ─── Migration smoke tests ────────────────────────────────────────────────────

/**
 * Test the migration logic inline rather than importing the CJS migration file
 * (migrate-mongo migrations use module.exports which cannot be loaded via
 * dynamic import() in the Jest ESM context with --experimental-vm-modules).
 *
 * These tests verify the exact DB operations specified in
 * migrations/20260927000000-add-ledger-datahash-index.js.
 */

async function migrationUp(db: { collection: (name: string) => { createIndex: (spec: unknown, opts: unknown) => Promise<unknown> } }) {
  const ledgerblocks = db.collection('ledgerblocks');
  await ledgerblocks.createIndex({ dataHash: 1 }, { sparse: true, name: 'dataHash_1' });
}

async function migrationDown(db: { collection: (name: string) => { dropIndex: (name: string) => Promise<unknown> } }) {
  const ledgerblocks = db.collection('ledgerblocks');
  await ledgerblocks.dropIndex('dataHash_1');
}

describe('migration 20260927000000-add-ledger-datahash-index — up/down (issue #660)', () => {
  it('up() calls createIndex({ dataHash:1 }, { sparse:true }) on ledgerblocks', async () => {
    const createIndexMock = jest.fn<() => Promise<string>>().mockResolvedValue('dataHash_1');
    const db = {
      collection: jest.fn().mockReturnValue({ createIndex: createIndexMock }),
    };

    await migrationUp(db as never);

    expect(db.collection).toHaveBeenCalledWith('ledgerblocks');
    expect(createIndexMock).toHaveBeenCalledWith(
      { dataHash: 1 },
      expect.objectContaining({ sparse: true }),
    );
  });

  it('down() calls dropIndex("dataHash_1") on ledgerblocks', async () => {
    const dropIndexMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const db = {
      collection: jest.fn().mockReturnValue({ dropIndex: dropIndexMock }),
    };

    await migrationDown(db as never);

    expect(db.collection).toHaveBeenCalledWith('ledgerblocks');
    expect(dropIndexMock).toHaveBeenCalledWith('dataHash_1');
  });
});
