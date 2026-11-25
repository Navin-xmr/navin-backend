/**
 * Tests for P13-02 — Database-enforced deduplication on idempotencyKey.
 *
 * Requirements:
 *  1. Unique partial index created via migration.
 *  2. Duplicate insert is rejected at the DB layer.
 *  3. Migration up/down; duplicate-insert test.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Types } from 'mongoose';
import { LedgerBlock } from '../src/modules/ledger/ledger.model.js';
import { MilestoneEvent } from '../src/shared/types/shipment.js';
import {
  up as migrationUp,
  down as migrationDown,
} from '../migrations/20261124000000-add-ledger-idempotency-key-index.js';

describe('P13-02 — LedgerBlock idempotencyKey unique partial index', () => {
  describe('Schema declaration', () => {
    it('defines a unique partial index on { idempotencyKey: 1 }', () => {
      const indexes = LedgerBlock.schema.indexes();
      const match = indexes.find(
        ([fields]: [Record<string, unknown>]) => fields.idempotencyKey === 1
      );

      expect(match).toBeDefined();
      const [, options] = match as [unknown, Record<string, unknown>];
      expect(options).toMatchObject({
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      });
    });
  });

  describe('Migration up/down', () => {
    it('up() creates the unique partial index on ledgerblocks', async () => {
      const createIndexMock = jest.fn<() => Promise<string>>().mockResolvedValue('idempotencyKey_1');
      const db = {
        collection: jest.fn().mockReturnValue({ createIndex: createIndexMock }),
      };

      await migrationUp(db as never);

      expect(db.collection).toHaveBeenCalledWith('ledgerblocks');
      expect(createIndexMock).toHaveBeenCalledWith(
        { idempotencyKey: 1 },
        expect.objectContaining({
          unique: true,
          partialFilterExpression: { idempotencyKey: { $type: 'string' } },
          name: 'idempotencyKey_1',
        })
      );
    });

    it('down() drops the index idempotencyKey_1 from ledgerblocks', async () => {
      const dropIndexMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const db = {
        collection: jest.fn().mockReturnValue({ dropIndex: dropIndexMock }),
      };

      await migrationDown(db as never);

      expect(db.collection).toHaveBeenCalledWith('ledgerblocks');
      expect(dropIndexMock).toHaveBeenCalledWith('idempotencyKey_1');
    });
  });

  describe('Database layer duplicate rejection', () => {
    beforeEach(async () => {
      await LedgerBlock.deleteMany({});
      await LedgerBlock.init(); // Ensure indexes are built in MongoDB
    });

    it('rejects duplicate inserts with the same idempotencyKey at the DB layer', async () => {
      const shipmentId = new Types.ObjectId();
      const idempotencyKey = 'idem-unique-test-key-1';

      await LedgerBlock.create({
        shipmentId,
        milestoneEvent: MilestoneEvent.IN_TRANSIT,
        transactionHash: 'tx-hash-first-'.padEnd(64, '0'),
        idempotencyKey,
      });

      // Second insert with the identical idempotencyKey must be rejected by the DB index (E11000)
      await expect(
        LedgerBlock.create({
          shipmentId,
          milestoneEvent: MilestoneEvent.IN_TRANSIT,
          transactionHash: 'tx-hash-second-'.padEnd(64, '0'),
          idempotencyKey,
        })
      ).rejects.toThrow(/(E11000|duplicate key)/i);
    });

    it('allows multiple documents without idempotencyKey (partial index protects legacy rows)', async () => {
      const shipmentId = new Types.ObjectId();

      const doc1 = await LedgerBlock.create({
        shipmentId,
        milestoneEvent: MilestoneEvent.IN_TRANSIT,
        transactionHash: 'tx-hash-legacy-1-'.padEnd(64, '0'),
      });

      const doc2 = await LedgerBlock.create({
        shipmentId,
        milestoneEvent: MilestoneEvent.DELIVERED,
        transactionHash: 'tx-hash-legacy-2-'.padEnd(64, '0'),
      });

      expect(doc1._id).toBeDefined();
      expect(doc2._id).toBeDefined();
    });
  });
});
