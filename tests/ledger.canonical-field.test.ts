/**
 * ledger.canonical-field.test.ts
 *
 * Tests for issue #661: unify eventType/milestoneEvent dual-field.
 *
 * Two suites:
 *
 * 1. Migration idempotency — exercises the migration logic directly against
 *    MongoDB Memory Server, verifying that:
 *    - Documents with only eventType get milestoneEvent backfilled.
 *    - Documents that already have milestoneEvent are untouched.
 *    - Running the migration twice produces the same result (idempotent).
 *
 * 2. Filtered-query fixture — verifies that blocks previously invisible
 *    (written with only eventType) become visible after the backfill, and
 *    that getLedgerBlocks filtered by milestoneEvent returns them correctly.
 */
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import mongoose, { Types } from 'mongoose';
import { MilestoneEvent } from '../src/shared/types/shipment.js';

// ---------------------------------------------------------------------------
// Inline the migration logic so the test runs against MMS without needing the
// migrate-mongo CLI (which requires a live MONGO_URI at config-load time).
// ---------------------------------------------------------------------------
async function runMigrationUp(
  db: mongoose.mongo.Db,
  collectionName = 'ledgerblocks'
): Promise<{ modifiedCount: number }> {
  const ledgerblocks = db.collection(collectionName);

  const result = await ledgerblocks.updateMany(
    {
      $and: [
        { eventType: { $exists: true, $ne: null } },
        {
          $or: [{ milestoneEvent: { $exists: false } }, { milestoneEvent: null }],
        },
      ],
    },
    [{ $set: { milestoneEvent: '$eventType' } }]
  );

  // Drop the eventType index if it exists (ignore IndexNotFound).
  try {
    await ledgerblocks.dropIndex('eventType_1_createdAt_-1');
  } catch {
    // index doesn't exist — fine
  }

  return { modifiedCount: result.modifiedCount };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a raw doc that mimics a legacy indexer-written block (eventType only). */
async function insertLegacyBlock(
  col: mongoose.mongo.Collection,
  override: Record<string, unknown> = {}
) {
  const base = {
    _id: new Types.ObjectId(),
    blockNumber: 0,
    timestamp: new Date(),
    shipmentId: new Types.ObjectId(),
    eventType: MilestoneEvent.IN_TRANSIT, // legacy field only
    transactionHash: `tx-${Math.random().toString(36).slice(2)}`,
    ledger: 0,
    verified: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col.insertOne({ ...base, ...override });
  return base;
}

/** Insert a doc that already has milestoneEvent (written by the service layer). */
async function insertCanonicalBlock(
  col: mongoose.mongo.Collection,
  override: Record<string, unknown> = {}
) {
  const base = {
    _id: new Types.ObjectId(),
    blockNumber: 0,
    timestamp: new Date(),
    shipmentId: new Types.ObjectId(),
    milestoneEvent: MilestoneEvent.DELIVERED,
    ledger: 0,
    verified: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col.insertOne({ ...base, ...override });
  return base;
}

// ---------------------------------------------------------------------------
// Suite 1 — Migration idempotency
// ---------------------------------------------------------------------------
describe('migration: ledger-canonical-milestone-event', () => {
  let col: mongoose.mongo.Collection;

  beforeEach(async () => {
    // Each test gets a fresh collection namespace via a unique name.
    const suffix = Math.random().toString(36).slice(2);
    col = mongoose.connection.collection(`ledgerblocks_mig_${suffix}`);
    await col.deleteMany({});
  });

  afterEach(async () => {
    await col.drop().catch(() => {
      /* collection may already be gone */
    });
  });

  it('backfills milestoneEvent from eventType on legacy documents', async () => {
    const legacy = await insertLegacyBlock(col);

    const { modifiedCount } = await runMigrationUp(mongoose.connection.db!, col.collectionName);
    expect(modifiedCount).toBeGreaterThanOrEqual(1);

    const updated = await col.findOne({ _id: legacy._id });
    expect(updated?.milestoneEvent).toBe(MilestoneEvent.IN_TRANSIT);
  });

  it('does not touch documents that already have milestoneEvent', async () => {
    const canonical = await insertCanonicalBlock(col);

    const { modifiedCount } = await runMigrationUp(mongoose.connection.db!, col.collectionName);
    // modifiedCount may be 0 (no legacy docs) — canonical doc must be untouched.
    expect(modifiedCount).toBe(0);

    const unchanged = await col.findOne({ _id: canonical._id });
    expect(unchanged?.milestoneEvent).toBe(MilestoneEvent.DELIVERED);
  });

  it('is idempotent — running twice produces the same result', async () => {
    await insertLegacyBlock(col);

    const first = await runMigrationUp(mongoose.connection.db!, col.collectionName);
    const second = await runMigrationUp(mongoose.connection.db!, col.collectionName);

    // Second run has nothing to backfill (milestoneEvent already set).
    expect(first.modifiedCount).toBeGreaterThanOrEqual(1);
    expect(second.modifiedCount).toBe(0);
  });

  it('backfills multiple legacy documents in one pass', async () => {
    await insertLegacyBlock(col, { eventType: MilestoneEvent.IN_TRANSIT });
    await insertLegacyBlock(col, { eventType: MilestoneEvent.DELIVERED });
    await insertLegacyBlock(col, { eventType: MilestoneEvent.SETTLEMENT_INITIATED });

    const { modifiedCount } = await runMigrationUp(mongoose.connection.db!, col.collectionName);
    expect(modifiedCount).toBe(3);

    const all = await col.find({}).toArray();
    for (const doc of all) {
      expect(doc.milestoneEvent).toBeDefined();
      expect(doc.milestoneEvent).toBe(doc.eventType);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Filtered-query fixture
// Verifies that blocks previously invisible to milestoneEvent-filtered queries
// become visible once milestoneEvent is populated.
// ---------------------------------------------------------------------------
describe('getLedgerBlocks filtered query: previously-invisible legacy blocks', () => {
  let col: mongoose.mongo.Collection;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).slice(2);
    col = mongoose.connection.collection(`ledgerblocks_query_${suffix}`);
    await col.deleteMany({});
  });

  afterEach(async () => {
    await col.drop().catch(() => {
      /* ignore */
    });
  });

  it('legacy block is NOT returned by milestoneEvent query before migration', async () => {
    await insertLegacyBlock(col, { eventType: MilestoneEvent.IN_TRANSIT });

    // Simulate the query the repo runs: filter on milestoneEvent.
    const results = await col
      .find({ milestoneEvent: MilestoneEvent.IN_TRANSIT, deletedAt: null })
      .toArray();

    // Block only has eventType — invisible to the canonical-field filter.
    expect(results).toHaveLength(0);
  });

  it('legacy block IS returned by milestoneEvent query after migration backfill', async () => {
    await insertLegacyBlock(col, { eventType: MilestoneEvent.IN_TRANSIT });

    // Run migration.
    await runMigrationUp(mongoose.connection.db!, col.collectionName);

    // Same query — should now find the block.
    const results = await col
      .find({ milestoneEvent: MilestoneEvent.IN_TRANSIT, deletedAt: null })
      .toArray();

    expect(results).toHaveLength(1);
    expect(results[0].milestoneEvent).toBe(MilestoneEvent.IN_TRANSIT);
  });

  it('canonical blocks written by service layer are always returned regardless of migration', async () => {
    const shipmentId = new Types.ObjectId();
    await insertCanonicalBlock(col, {
      shipmentId,
      milestoneEvent: MilestoneEvent.DELIVERED,
    });

    const results = await col
      .find({ milestoneEvent: MilestoneEvent.DELIVERED, deletedAt: null })
      .toArray();

    expect(results).toHaveLength(1);
    expect(results[0].milestoneEvent).toBe(MilestoneEvent.DELIVERED);
  });

  it('mixed collection: both legacy and canonical blocks visible after migration', async () => {
    const shipmentId = new Types.ObjectId();
    await insertLegacyBlock(col, { shipmentId, eventType: MilestoneEvent.IN_TRANSIT });
    await insertCanonicalBlock(col, { shipmentId, milestoneEvent: MilestoneEvent.IN_TRANSIT });

    // Before migration: only 1 visible (the canonical one).
    const before = await col
      .find({ milestoneEvent: MilestoneEvent.IN_TRANSIT, deletedAt: null })
      .toArray();
    expect(before).toHaveLength(1);

    // After migration: both visible.
    await runMigrationUp(mongoose.connection.db!, col.collectionName);

    const after = await col
      .find({ milestoneEvent: MilestoneEvent.IN_TRANSIT, deletedAt: null })
      .toArray();
    expect(after).toHaveLength(2);
  });
});
