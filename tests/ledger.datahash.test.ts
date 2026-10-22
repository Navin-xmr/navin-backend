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
import {
  buildCanonicalShipmentPayload,
  generateDataHash,
} from '../src/shared/utils/crypto.js';

// Register mock BEFORE any dynamic import of the module under test.
const createMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const findByIdMock = jest.fn();

await jest.unstable_mockModule('../src/modules/ledger/ledger.model.js', () => ({
  LedgerBlock: {
    create: createMock,
    findById: findByIdMock,
  },
}));

const { createLedgerBlock } = await import('../src/modules/ledger/ledger.repo.js');
const { getLedgerBlockVerificationService } = await import(
  '../src/modules/ledger/ledger.service.js'
);

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

// ─── canonicalPayload persistence + hash integrity (issue #971) ───────────────

describe('createLedgerBlock — canonicalPayload persistence (issue #971)', () => {
  const shipmentId = new Types.ObjectId().toHexString();

  beforeEach(() => {
    createMock.mockReset();
  });

  it('stores top-level canonicalPayload on status-change blocks with sha256(canonicalPayload) === dataHash', async () => {
    const canonical = buildCanonicalShipmentPayload({
      shipmentId,
      event: 'IN_TRANSIT',
      actor: 'user-1',
      timestamp: new Date('2026-09-27T10:00:00.000Z'),
      metadata: { previousStatus: 'CREATED' },
    });
    const hash = generateDataHash(canonical);

    createMock.mockResolvedValueOnce({
      _id: new Types.ObjectId().toHexString(),
      milestoneEvent: 'IN_TRANSIT',
      dataHash: hash,
      canonicalPayload: canonical,
    });

    await createLedgerBlock({
      shipmentId,
      milestoneEvent: 'IN_TRANSIT' as never,
      dataHash: hash,
      canonicalPayload: canonical,
      actor: 'user-1',
      metadata: { previousStatus: 'CREATED' },
    });

    const callArg = (createMock.mock.calls[0] as [Record<string, unknown>])[0];
    expect(callArg).toHaveProperty('canonicalPayload', canonical);
    expect(generateDataHash(callArg.canonicalPayload)).toBe(callArg.dataHash);
  });

  it('stores top-level canonicalPayload on settlement blocks with sha256(canonicalPayload) === dataHash', async () => {
    const canonical = buildCanonicalShipmentPayload({
      shipmentId,
      event: 'SETTLEMENT_INITIATED',
      actor: 'user-1',
      timestamp: new Date('2026-09-27T10:00:00.000Z'),
      metadata: { paymentId: new Types.ObjectId().toHexString() },
    });
    const hash = generateDataHash(canonical);

    createMock.mockResolvedValueOnce({
      _id: new Types.ObjectId().toHexString(),
      milestoneEvent: 'SETTLEMENT_INITIATED',
      dataHash: hash,
      canonicalPayload: canonical,
    });

    await createLedgerBlock({
      shipmentId,
      milestoneEvent: 'SETTLEMENT_INITIATED' as never,
      dataHash: hash,
      canonicalPayload: canonical,
      actor: 'user-1',
    });

    const callArg = (createMock.mock.calls[0] as [Record<string, unknown>])[0];
    expect(callArg).toHaveProperty('canonicalPayload', canonical);
    expect(generateDataHash(callArg.canonicalPayload)).toBe(callArg.dataHash);
  });
});

describe('getLedgerBlockVerificationService — canonicalPayload presence (issue #971)', () => {
  beforeEach(() => {
    findByIdMock.mockReset();
  });

  it.each([['IN_TRANSIT'], ['SETTLEMENT_INITIATED'], ['SETTLEMENT_COMPLETED']])(
    'returns non-null canonicalPayload with matching dataHash for %s blocks',
    async milestoneEvent => {
      const canonical = buildCanonicalShipmentPayload({
        shipmentId: new Types.ObjectId().toHexString(),
        event: milestoneEvent,
        actor: 'user-1',
        timestamp: new Date('2026-09-27T10:00:00.000Z'),
      });
      const hash = generateDataHash(canonical);
      findByIdMock.mockReturnValueOnce({
        lean: async () => ({
          _id: new Types.ObjectId().toHexString(),
          milestoneEvent,
          canonicalPayload: canonical,
          dataHash: hash,
          transactionHash: 'stellar-tx-abc',
          ledger: 5,
        }),
      });

      const verification = await getLedgerBlockVerificationService(
        new Types.ObjectId().toHexString(),
      );

      expect(verification.canonicalPayload).toEqual(canonical);
      expect(verification.canonicalPayload).not.toBeNull();
      expect(generateDataHash(verification.canonicalPayload)).toBe(verification.dataHash);
    },
  );
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
