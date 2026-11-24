/**
 * Migration: add-ledger-idempotency-key-index (P13-02)
 *
 * Adds a unique partial index on `ledgerblocks.idempotencyKey` so deduplication
 * is enforced by the database layer, not only application logic.
 *
 * The partialFilterExpression `{ idempotencyKey: { $type: 'string' } }` ensures
 * that documents without an idempotencyKey (legacy rows, internal worker records)
 * are excluded from the index and remain unaffected.
 */

export async function up(db) {
  const ledgerblocks = db.collection('ledgerblocks');
  await ledgerblocks.createIndex(
    { idempotencyKey: 1 },
    {
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      name: 'idempotencyKey_1',
    }
  );
}

export async function down(db) {
  const ledgerblocks = db.collection('ledgerblocks');
  await ledgerblocks.dropIndex('idempotencyKey_1');
}
