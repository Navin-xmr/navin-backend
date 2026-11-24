/**
 * Tests for P15-02 — Contract upgrade version detection and alerting.
 *
 * Requirements:
 *  1. Backend detects a version change and alerts (logs error alert and sets metric gauge).
 *  2. Matching version clears alert state.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  checkAndAlertContractVersion,
} from '../src/workers/stellar-indexer.worker.js';
import { metricsRegistry, resetChainMetricsForTests } from '../src/infra/metrics/chainMetrics.js';
import { CHAIN_SPEC_VERSION } from '../src/shared/types/chain.js';

describe('P15-02 — Contract version detection and alerting', () => {
  beforeEach(() => {
    resetChainMetricsForTests();
    jest.clearAllMocks();
  });

  it('detects a version change, raises an alert, and sets the metric gauge to 1', async () => {
    const upgradedVersion = '3.0.0'; // Different from CHAIN_SPEC_VERSION ('2.1.0')

    const isMatch = checkAndAlertContractVersion(upgradedVersion, {
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2B',
      txHash: 'a'.repeat(64),
    });

    expect(isMatch).toBe(false);

    // Verify Prometheus metric gauge
    const metrics = await metricsRegistry.metrics();
    expect(metrics).toContain('navin_chain_contract_version_mismatch');
    expect(metrics).toMatch(/navin_chain_contract_version_mismatch{[^}]*}\s+1/);
  });

  it('clears the alert and sets the metric gauge to 0 when the contract version matches', async () => {
    // First trigger mismatch
    checkAndAlertContractVersion('9.9.9');
    let metrics = await metricsRegistry.metrics();
    expect(metrics).toMatch(/navin_chain_contract_version_mismatch{[^}]*}\s+1/);

    // Then observe expected version
    const isMatch = checkAndAlertContractVersion(CHAIN_SPEC_VERSION);
    expect(isMatch).toBe(true);

    metrics = await metricsRegistry.metrics();
    expect(metrics).toMatch(/navin_chain_contract_version_mismatch{[^}]*}\s+0/);
  });
});
