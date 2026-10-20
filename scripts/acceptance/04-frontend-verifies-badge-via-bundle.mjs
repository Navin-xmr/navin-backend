#!/usr/bin/env node
/**
 * Acceptance Scenario 4: frontend verifies badge via bundle endpoint (Issue #807 / P6-20).
 *
 * Verifies that the frontend verification bundle endpoint returns a complete
 * verification bundle (`onChainHash`, `recomputedHash`, `verified`, `simulated`,
 * `network`, `badgeStatus`, `txHash`, `explorerUrl`) that resolves to:
 *   - `verified: true` (`badgeStatus: 'VERIFIED'`) when off-chain data is intact
 *   - `verified: true` (`badgeStatus: 'SIMULATED_VERIFIED'`) in simulated mode
 *   - `verified: false` (`badgeStatus: 'MISMATCH'`) when off-chain data is tampered
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createConformanceHarness } from './harness.mjs';

export async function runScenario4(options = {}) {
  const harness =
    options.harness ?? createConformanceHarness({ network: 'testnet', simulated: false });
  const shipmentId = 'ship_badge_004';
  const scanPayload = {
    trackingNumber: 'NVN-2026-0004',
    origin: 'Lagos',
    destination: 'Abuja',
    scannedAt: '2026-10-19T14:00:00.000Z',
  };

  await harness.scanAndAnchor({
    shipmentId,
    scanPayload,
  });

  // 1. Intact payload -> VERIFIED badge
  const verifiedBundle = await harness.getVerificationBundle(shipmentId);
  assert.equal(verifiedBundle.verified, true, 'Intact shipment must verify as true');
  assert.equal(verifiedBundle.simulated, false);
  assert.equal(verifiedBundle.badgeStatus, 'VERIFIED');
  assert.equal(verifiedBundle.onChainHash, verifiedBundle.recomputedHash);
  assert.ok(verifiedBundle.explorerUrl.includes(verifiedBundle.txHash));

  // 2. Tampered off-chain payload -> MISMATCH badge
  const tamperedBundle = await harness.getVerificationBundle(shipmentId, {
    ...scanPayload,
    destination: 'TAMPERED_DESTINATION',
  });
  assert.equal(tamperedBundle.verified, false, 'Tampered shipment must fail verification');
  assert.equal(tamperedBundle.badgeStatus, 'MISMATCH');
  assert.notEqual(tamperedBundle.onChainHash, tamperedBundle.recomputedHash);

  // 3. Simulated adapter mode -> SIMULATED_VERIFIED badge
  const simHarness = createConformanceHarness({ network: 'testnet', simulated: true });
  await simHarness.scanAndAnchor({ shipmentId, scanPayload });
  const simulatedBundle = await simHarness.getVerificationBundle(shipmentId);
  assert.equal(simulatedBundle.verified, true);
  assert.equal(simulatedBundle.simulated, true);
  assert.equal(simulatedBundle.badgeStatus, 'SIMULATED_VERIFIED');

  return {
    scenario: '04-frontend-verifies-badge-via-bundle',
    passed: true,
    shipmentId,
    badgeStatus: verifiedBundle.badgeStatus,
    txHash: verifiedBundle.txHash,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScenario4()
    .then((res) => {
      process.stdout.write(
        `[PASS] ${res.scenario}: shipment=${res.shipmentId} badge=${res.badgeStatus} tx=${res.txHash.slice(0, 12)}...\n`
      );
    })
    .catch((err) => {
      process.stderr.write(`[FAIL] 04-frontend-verifies-badge-via-bundle: ${err.message}\n`);
      process.exit(1);
    });
}
