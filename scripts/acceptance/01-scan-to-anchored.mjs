#!/usr/bin/env node
/**
 * Acceptance Scenario 1: scan -> anchored (Issue #807 / P6-20).
 *
 * Verifies that an incoming shipment scan / telemetry event produces a
 * canonical 32-byte SHA-256 digest, invokes the ChainAdapter `anchor` method,
 * persists the resulting `txHash` and `ledger`, and rejects duplicate anchors
 * with `ERR_CHAIN_ALREADY_ANCHORED`.
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { computeCanonicalHash, createConformanceHarness } from './harness.mjs';

export async function runScenario1(options = {}) {
  const harness = options.harness ?? createConformanceHarness();
  const shipmentId = 'ship_scan_001';
  const scanPayload = {
    trackingNumber: 'NVN-2026-0001',
    latitude: 6.5244,
    longitude: 3.3792,
    temperatureC: 4.2,
    scannedAt: '2026-10-19T12:00:00.000Z',
  };

  const expectedHash = computeCanonicalHash({
    shipmentId,
    ...scanPayload,
  });

  const { receipt, record, emittedEvent } = await harness.scanAndAnchor({
    shipmentId,
    scanPayload,
  });

  assert.equal(record.anchorStatus, 'ANCHORED', 'Expected shipment anchorStatus to be ANCHORED');
  assert.equal(record.dataHash, expectedHash, 'Anchored data_hash must match canonical SHA-256');
  assert.match(receipt.txHash, /^[0-9a-f]{64}$/, 'Receipt txHash must be 64-char hex');
  assert.ok(receipt.ledger > 0, 'Receipt ledger must be positive');
  assert.equal(emittedEvent.name, 'anchor', 'Emitted event name must be anchor');
  assert.deepEqual(emittedEvent.topic, ['anchor', shipmentId]);
  assert.deepEqual(emittedEvent.data, [expectedHash, receipt.ledger]);

  // Duplicate anchor for the same shipment_id must reject with ERR_CHAIN_ALREADY_ANCHORED
  await assert.rejects(
    () => harness.scanAndAnchor({ shipmentId, scanPayload }),
    (err) => err.code === 'ERR_CHAIN_ALREADY_ANCHORED'
  );

  return {
    scenario: '01-scan-to-anchored',
    passed: true,
    shipmentId,
    dataHash: expectedHash,
    txHash: receipt.txHash,
    ledger: receipt.ledger,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScenario1()
    .then((res) => {
      process.stdout.write(
        `[PASS] ${res.scenario}: shipment=${res.shipmentId} tx=${res.txHash.slice(0, 12)}... ledger=${res.ledger}\n`
      );
    })
    .catch((err) => {
      process.stderr.write(`[FAIL] 01-scan-to-anchored: ${err.message}\n`);
      process.exit(1);
    });
}
