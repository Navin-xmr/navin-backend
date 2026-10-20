#!/usr/bin/env node
/**
 * Acceptance Scenario 2: deliver -> escrow released (Issue #807 / P6-20).
 *
 * Verifies that marking a funded shipment as DELIVERED with proof computes the
 * canonical delivery `proof_hash`, invokes `release_escrow(payment_id, proof_hash)`,
 * transitions the escrow to RELEASED with an `esc_rel` event, and rejects
 * double-release attempts with `ERR_CHAIN_ESCROW_ALREADY_RELEASED`.
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { computeCanonicalHash, createConformanceHarness } from './harness.mjs';

export async function runScenario2(options = {}) {
  const harness = options.harness ?? createConformanceHarness();
  const shipmentId = 'ship_deliver_002';
  const paymentId = 'pay_escrow_002';
  const deliveryProofUrl = 'https://storage.navin.io/proofs/ship_deliver_002.pdf';

  await harness.initEscrow({
    paymentId,
    shipmentId,
    amount: '5000000000',
  });

  const expectedProofHash = computeCanonicalHash({
    shipmentId,
    paymentId,
    deliveryProofUrl,
  });

  const { receipt, escrow, proofHash, emittedEvent } = await harness.deliverAndReleaseEscrow({
    paymentId,
    shipmentId,
    deliveryProofUrl,
  });

  assert.equal(escrow.status, 'RELEASED', 'Escrow status must transition to RELEASED');
  assert.equal(proofHash, expectedProofHash, 'Released proof_hash must match canonical SHA-256');
  assert.equal(receipt.paymentId, paymentId, 'Receipt paymentId must match');
  assert.match(receipt.txHash, /^[0-9a-f]{64}$/, 'Release txHash must be 64-char hex');
  assert.equal(emittedEvent.name, 'esc_rel', 'Emitted event must be esc_rel');
  assert.deepEqual(emittedEvent.topic, ['esc_rel', paymentId]);
  assert.equal(emittedEvent.data[0], expectedProofHash);

  // Double release must reject with ERR_CHAIN_ESCROW_ALREADY_RELEASED
  await assert.rejects(
    () =>
      harness.deliverAndReleaseEscrow({
        paymentId,
        shipmentId,
        deliveryProofUrl,
      }),
    (err) => err.code === 'ERR_CHAIN_ESCROW_ALREADY_RELEASED'
  );

  return {
    scenario: '02-deliver-to-escrow-released',
    passed: true,
    shipmentId,
    paymentId,
    proofHash,
    txHash: receipt.txHash,
    ledger: receipt.ledger,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScenario2()
    .then((res) => {
      process.stdout.write(
        `[PASS] ${res.scenario}: payment=${res.paymentId} tx=${res.txHash.slice(0, 12)}... ledger=${res.ledger}\n`
      );
    })
    .catch((err) => {
      process.stderr.write(`[FAIL] 02-deliver-to-escrow-released: ${err.message}\n`);
      process.exit(1);
    });
}
