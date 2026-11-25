import { describe, expect, it } from '@jest/globals';
import {
  CHAIN_ALERT_RULES,
  checkChannelLowBalance,
  checkDeadLetterGrowth,
  checkIndexerCursorStalled,
  checkReconciliationMismatch,
  checkSubmissionFailures,
  checkUnknownContractError,
  CHANNEL_LOW_BALANCE_THRESHOLD_STROOPS,
  DEAD_LETTER_THRESHOLD,
  INDEXER_STALLED_THRESHOLD_MIN,
  SUBMISSION_FAILURE_THRESHOLD,
  SUBMISSION_FAILURE_WINDOW_MIN,
} from '../src/services/chain-alerts.js';

const SHIPMENT_ID = 'chain';

describe('chain alert rules registry (P15-12)', () => {
  it('registers all six chain alert rules with severity, owner, and runbook link', () => {
    expect(CHAIN_ALERT_RULES).toHaveLength(6);

    const names = CHAIN_ALERT_RULES.map(r => r.name);
    expect(names).toContain('chain-submission-failures');
    expect(names).toContain('chain-spec-drift');
    expect(names).toContain('chain-indexer-stalled');
    expect(names).toContain('chain-reconciliation-mismatch');
    expect(names).toContain('chain-low-balance');
    expect(names).toContain('chain-dead-letter-growth');

    for (const rule of CHAIN_ALERT_RULES) {
      expect(rule.severity).toMatch(/^(low|medium|high|critical)$/);
      expect(rule.owner).toBeTruthy();
      expect(rule.runbookUrl).toMatch(/^docs\/runbooks\/.*\.md$/);
      expect(rule.description).toBeTruthy();
    }
  });
});

describe('checkSubmissionFailures — repeated submission failures', () => {
  it('returns null below the threshold', () => {
    expect(checkSubmissionFailures(2, SUBMISSION_FAILURE_WINDOW_MIN)).toBeNull();
  });

  it('returns an alert at the threshold', () => {
    const alert = checkSubmissionFailures(
      SUBMISSION_FAILURE_THRESHOLD,
      SUBMISSION_FAILURE_WINDOW_MIN
    );
    expect(alert).toMatchObject({
      type: 'CHAIN_SUBMISSION_FAILURES',
      shipmentId: SHIPMENT_ID,
    });
    expect(alert?.message).toContain(String(SUBMISSION_FAILURE_THRESHOLD));
    expect(alert?.message).toContain(String(SUBMISSION_FAILURE_WINDOW_MIN));
  });

  it('returns an alert above the threshold', () => {
    const alert = checkSubmissionFailures(10, SUBMISSION_FAILURE_WINDOW_MIN);
    expect(alert?.type).toBe('CHAIN_SUBMISSION_FAILURES');
    expect(alert?.message).toContain('10 failures');
  });
});

describe('checkUnknownContractError — spec drift / unknown contract error codes', () => {
  const knownCodes = [1, 2, 3, 4, 5, 6, 7, 8];

  it('returns null for every known contract error code', () => {
    for (const code of knownCodes) {
      expect(checkUnknownContractError(code, 'release_escrow')).toBeNull();
    }
  });

  it('returns an alert for an unknown contract error code (spec drift)', () => {
    const alert = checkUnknownContractError(99, 'release_escrow');
    expect(alert).toMatchObject({
      type: 'CHAIN_SPEC_DRIFT',
      shipmentId: SHIPMENT_ID,
    });
    expect(alert?.message).toContain('99');
    expect(alert?.message).toContain('release_escrow');
    expect(alert?.message).toContain('CHAIN_CONTRACT_ERRORS');
  });
});

describe('checkIndexerCursorStalled — indexer cursor stalled', () => {
  const now = new Date('2026-11-21T12:00:00Z');

  it('returns null when the cursor advanced recently', () => {
    const recent = new Date(now.getTime() - 5 * 60_000).toISOString(); // 5 min ago
    expect(checkIndexerCursorStalled(recent, now)).toBeNull();
  });

  it('returns null when there is no cursor yet', () => {
    expect(checkIndexerCursorStalled(undefined, now)).toBeNull();
  });

  it('returns an alert when the cursor is stalled beyond the threshold', () => {
    const stalled = new Date(
      now.getTime() - (INDEXER_STALLED_THRESHOLD_MIN + 5) * 60_000
    ).toISOString();
    const alert = checkIndexerCursorStalled(stalled, now);
    expect(alert).toMatchObject({
      type: 'CHAIN_INDEXER_STALLED',
      shipmentId: SHIPMENT_ID,
    });
    expect(alert?.message).toContain(String(INDEXER_STALLED_THRESHOLD_MIN));
  });
});

describe('checkReconciliationMismatch — reconciliation mismatches (P13-12)', () => {
  it('forwards the reconciliation mismatch as a chain alert', () => {
    const alert = checkReconciliationMismatch({
      type: 'ESCROW_AMOUNT_MISMATCH',
      message: 'DB 100 XLM vs chain 150 XLM',
      paymentId: 'pay-1',
      shipmentId: 'ship-1',
      chainAmountStroops: '1500000000',
      dbAmountStroops: '1000000000',
    });

    expect(alert).toMatchObject({
      type: 'CHAIN_RECONCILIATION_MISMATCH',
      shipmentId: 'ship-1',
    });
    expect(alert?.message).toContain('pay-1');
    expect(alert?.message).toContain('DB 100 XLM vs chain 150 XLM');
  });
});

describe('checkChannelLowBalance — low channel-account balance', () => {
  it('returns null when balance is at or above the threshold', () => {
    expect(checkChannelLowBalance(CHANNEL_LOW_BALANCE_THRESHOLD_STROOPS)).toBeNull();
    expect(checkChannelLowBalance(CHANNEL_LOW_BALANCE_THRESHOLD_STROOPS + 1n)).toBeNull();
  });

  it('returns an alert when balance is below the threshold', () => {
    const alert = checkChannelLowBalance(500n * 10_000_000n); // 500 XLM
    expect(alert).toMatchObject({
      type: 'CHAIN_LOW_BALANCE',
      shipmentId: SHIPMENT_ID,
    });
    expect(alert?.message).toContain('500 XLM');
    expect(alert?.message).toContain('1,000 XLM');
  });
});

describe('checkDeadLetterGrowth — dead-letter growth', () => {
  it('returns null below the threshold', () => {
    expect(checkDeadLetterGrowth(DEAD_LETTER_THRESHOLD - 1)).toBeNull();
  });

  it('returns an alert at and above the threshold', () => {
    const alert = checkDeadLetterGrowth(DEAD_LETTER_THRESHOLD);
    expect(alert).toMatchObject({
      type: 'CHAIN_DEAD_LETTER_GROWTH',
      shipmentId: SHIPMENT_ID,
    });
    expect(alert?.message).toContain(String(DEAD_LETTER_THRESHOLD));

    const above = checkDeadLetterGrowth(DEAD_LETTER_THRESHOLD + 5);
    expect(above?.type).toBe('CHAIN_DEAD_LETTER_GROWTH');
  });
});
