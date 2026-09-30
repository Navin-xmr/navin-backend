'use strict';

/**
 * Migration: add-ledger-canonical-payload
 *
 * `ledgerblocks.canonicalPayload` stores the exact deterministic payload
 * hashed into `dataHash` (#655). Mixed type needs no index; existing blocks
 * without the field stay valid (verification returns canonicalPayload: null).
 * Backfill is opportunistic: new writes persist it, old blocks are left as-is.
 */

module.exports = {
  async up() {
    // No index required for Mixed payload. No-op for existing documents.
  },

  async down() {
    // No-op: dropping the field is handled by application roll-forward.
  },
};
