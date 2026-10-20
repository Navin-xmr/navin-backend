#!/usr/bin/env node
/**
 * Acceptance Scenario 3: indexer ingests emitted event (Issue #807 / P6-20).
 *
 * Verifies that the Stellar event indexer consumes `anchor`, `esc_init`, and
 * `esc_rel` contract events in ledger order via `streamEvents(cursor)`, maps
 * them to `IN_TRANSIT`, `SETTLEMENT_INITIATED`, and `SETTLEMENT_COMPLETED`
 * ledger blocks, advances the cursor idempotently, and avoids duplicates on
 * replay.
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createConformanceHarness } from './harness.mjs';

export async function runScenario3(options = {}) {
  const harness = options.harness ?? createConformanceHarness();
  const shipmentId = 'ship_idx_003';
  const paymentId = 'pay_idx_003';

  await harness.scanAndAnchor({
    shipmentId,
    scanPayload: {
      trackingNumber: 'NVN-2026-0003',
      latitude: 9.0765,
      longitude: 7.3986,
      scannedAt: '2026-10-19T13:00:00.000Z',
    },
  });

  await harness.initEscrow({
    paymentId,
    shipmentId,
    amount: '7500000000',
  });

  await harness.deliverAndReleaseEscrow({
    paymentId,
    shipmentId,
    deliveryProofUrl: 'https://storage.navin.io/proofs/ship_idx_003.pdf',
  });

  const cycle1 = await harness.runIndexerCycle();
  assert.equal(cycle1.processed, 3, 'First indexer cycle must process all 3 emitted events');
  assert.equal(cycle1.upserted, 3, 'First indexer cycle must upsert 3 unique ledger blocks');
  assert.ok(cycle1.lastCursor, 'Indexer must record a non-empty lastCursor');

  const eventTypes = cycle1.blocks.map((b) => b.eventType);
  assert.deepEqual(eventTypes, [
    'IN_TRANSIT',
    'SETTLEMENT_INITIATED',
    'SETTLEMENT_COMPLETED',
  ]);

  // Second cycle starting from saved cursor should process 0 new events
  const cycle2 = await harness.runIndexerCycle();
  assert.equal(cycle2.processed, 0, 'Subsequent cycle with no new events must process 0');
  assert.equal(cycle2.upserted, 0, 'Subsequent cycle must upsert 0 duplicates');

  // Full replay from undefined cursor must be idempotent (0 new upserts)
  const replayCycle = await harness.runIndexerCycle('');
  assert.equal(replayCycle.processed, 3);
  assert.equal(replayCycle.upserted, 0, 'Replaying already-indexed events must not duplicate blocks');

  return {
    scenario: '03-indexer-ingests-emitted-event',
    passed: true,
    processed: cycle1.processed,
    upserted: cycle1.upserted,
    lastCursor: cycle1.lastCursor,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScenario3()
    .then((res) => {
      process.stdout.write(
        `[PASS] ${res.scenario}: processed=${res.processed} upserted=${res.upserted} cursor=${res.lastCursor}\n`
      );
    })
    .catch((err) => {
      process.stderr.write(`[FAIL] 03-indexer-ingests-emitted-event: ${err.message}\n`);
      process.exit(1);
    });
}
