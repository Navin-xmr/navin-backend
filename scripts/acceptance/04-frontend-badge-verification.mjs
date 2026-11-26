#!/usr/bin/env node
/* eslint-env node */
/** Scenario 4: frontend verifies badge via bundle endpoint. Usage: BADGE_BLOCK_ID=<ledger block id> node scripts/acceptance/04-frontend-badge-verification.mjs */
import { createHash } from 'node:crypto';
import { api, assert, run } from './scenario.mjs';

const blockId = process.env.BADGE_BLOCK_ID;
await run('frontend verifies badge via bundle endpoint', async () => {
  assert(blockId, 'BADGE_BLOCK_ID must be set');
  const verification = await api(`/ledger/blocks/${blockId}/verification`);
  assert(verification.ok, `verification bundle fetch failed (HTTP ${verification.status})`);
  const bundle = verification.data?.verification ?? verification.data;
  assert(bundle?.canonicalPayload, 'verification bundle has no canonicalPayload');
  assert(bundle?.dataHash, 'verification bundle has no dataHash');
  const computed = createHash('sha256').update(JSON.stringify(bundle.canonicalPayload)).digest('hex');
  assert(computed === bundle.dataHash, `bundle hash mismatch: ${computed} !== ${bundle.dataHash}`);
  console.log(`[acceptance] bundle verified for block ${blockId}`);
});
