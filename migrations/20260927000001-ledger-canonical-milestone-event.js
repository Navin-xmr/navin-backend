/**
 * Migration: Unify eventType/milestoneEvent dual-field (#661)
 *
 * Problem
 * -------
 * The stellar-indexer worker writes blocks using `eventType`; the repo query
 * layer filters on `milestoneEvent`.  Blocks inserted by the indexer have
 * milestoneEvent=undefined, making them invisible to filtered queries.
 *
 * Fix
 * ---
 * 1. Backfill: for every LedgerBlock where milestoneEvent is missing/null and
 *    eventType is set, copy eventType → milestoneEvent.
 * 2. Drop the now-redundant `eventType_1_createdAt_-1` index.
 *    (The canonical `shipmentId_1_milestoneEvent_1_createdAt_-1` index already
 *    covers the milestoneEvent lookup path.)
 *
 * Idempotency
 * -----------
 * Step 1 only touches documents where milestoneEvent is null/missing — running
 * it twice is a no-op.  Step 2 uses dropIndex with ifExists-style error
 * handling so a missing index is silently ignored.
 */

export async function up(db) {
  const ledgerblocks = db.collection('ledgerblocks');

  // Step 1 — backfill milestoneEvent from eventType.
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

  console.log(
    `[migration] ledger-canonical-milestone-event: backfilled milestoneEvent on ${result.modifiedCount} document(s).`
  );

  // Step 2 — drop the legacy eventType index (may not exist on fresh DBs).
  try {
    await ledgerblocks.dropIndex('eventType_1_createdAt_-1');
    console.log('[migration] ledger-canonical-milestone-event: dropped eventType index.');
  } catch (err) {
    if (err.codeName === 'IndexNotFound' || err.code === 27) {
      console.log(
        '[migration] ledger-canonical-milestone-event: eventType index not found — skipping drop.'
      );
    } else {
      throw err;
    }
  }
}

export async function down(db) {
  const ledgerblocks = db.collection('ledgerblocks');

  // Restore the eventType index so the previous code can run again.
  await ledgerblocks.createIndex({ eventType: 1, createdAt: -1 });
  console.log('[migration] ledger-canonical-milestone-event (rollback): restored eventType index.');

  // NOTE: We do NOT clear milestoneEvent values set by the backfill because
  // the previous schema still reads milestoneEvent for display; rolling back
  // the index is sufficient to restore previous read/write behaviour.
}
