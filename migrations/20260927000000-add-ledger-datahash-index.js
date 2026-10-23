/**
 * Migration: add-ledger-datahash-index
 *
 * Adds a sparse index on `ledgerblocks.dataHash` to support fast lookup
 * and deduplication by the SHA-256 hash of the on-chain committed payload.
 *
 * `sparse: true` means documents without the field are excluded from the
 * index, keeping index size minimal for existing blocks that predate this field.
 */

export async function up(db) {
  const ledgerblocks = db.collection('ledgerblocks');
  await ledgerblocks.createIndex({ dataHash: 1 }, { sparse: true, name: 'dataHash_1' });
}

export async function down(db) {
  const ledgerblocks = db.collection('ledgerblocks');
  await ledgerblocks.dropIndex('dataHash_1');
}
