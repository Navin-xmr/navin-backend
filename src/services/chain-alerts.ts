/**
 * Chain alert rules (P15-12).
 *
 * Pure, testable alert rules for the Stellar / Soroban integration. Each rule
 * inspects domain-specific inputs and returns an `AlertPayload` when the
 * threshold is breached, or `null` when everything is healthy. Rules never
 * perform I/O — they are invoked by the indexer / worker / reconciliation
 * layer, which enqueues the returned payload via `dispatchAlert`.
 *
 * Thresholds are exported constants so they are easy to review and tune.
 * Every rule documents its severity, owner, and runbook link.
 */
import type { AlertPayload } from './queue.service.js';

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** Max submission failures allowed within the failure window before alerting. */
export const SUBMISSION_FAILURE_THRESHOLD = 3;

/** Failure window in minutes for submission-failure counting. */
export const SUBMISSION_FAILURE_WINDOW_MIN = 5;

/** Minutes the indexer cursor may remain unchanged before a stalled alert. */
export const INDEXER_STALLED_THRESHOLD_MIN = 10;

/** Low native-balance threshold for the channel (signing) account, in stroops. */
export const CHANNEL_LOW_BALANCE_THRESHOLD_STROOPS = 1000n * 10_000_000n; // 1,000 XLM

/** Max failed/dead-letter jobs allowed before a dead-letter growth alert. */
export const DEAD_LETTER_THRESHOLD = 10;

// ─── Alert rule metadata ───────────────────────────────────────────────────

export interface ChainAlertRule {
  name: string;
  type: AlertPayload['type'];
  severity: 'low' | 'medium' | 'high' | 'critical';
  owner: string;
  runbookUrl: string;
  description: string;
}

export const CHAIN_ALERT_RULES: ReadonlyArray<ChainAlertRule> = [
  {
    name: 'chain-submission-failures',
    type: 'CHAIN_SUBMISSION_FAILURES',
    severity: 'high',
    owner: 'Platform Team',
    runbookUrl: 'docs/runbooks/chain-submission-failures.md',
    description: 'Repeated Stellar / Soroban submission failures within the failure window.',
  },
  {
    name: 'chain-spec-drift',
    type: 'CHAIN_SPEC_DRIFT',
    severity: 'critical',
    owner: 'Platform Team',
    runbookUrl: 'docs/runbooks/chain-spec-drift.md',
    description: 'Contract returned an error code not in the spec (spec drift).',
  },
  {
    name: 'chain-indexer-stalled',
    type: 'CHAIN_INDEXER_STALLED',
    severity: 'high',
    owner: 'Platform Team',
    runbookUrl: 'docs/runbooks/chain-indexer-stalled.md',
    description: 'Indexer cursor has not advanced within the stalled threshold.',
  },
  {
    name: 'chain-reconciliation-mismatch',
    type: 'CHAIN_RECONCILIATION_MISMATCH',
    severity: 'critical',
    owner: 'Platform Team / Finance',
    runbookUrl: 'docs/runbooks/chain-reconciliation-mismatch.md',
    description: 'On-chain escrow amount disagrees with the payment record.',
  },
  {
    name: 'chain-low-balance',
    type: 'CHAIN_LOW_BALANCE',
    severity: 'medium',
    owner: 'Platform Team',
    runbookUrl: 'docs/runbooks/chain-low-balance.md',
    description: 'Channel (signing) account native balance is below the low-balance threshold.',
  },
  {
    name: 'chain-dead-letter-growth',
    type: 'CHAIN_DEAD_LETTER_GROWTH',
    severity: 'high',
    owner: 'Platform Team',
    runbookUrl: 'docs/runbooks/chain-dead-letter-growth.md',
    description: 'Failed / dead-letter jobs are growing in the BullMQ queue.',
  },
] as const;

// ─── Alert rule checks ─────────────────────────────────────────────────────

/**
 * Repeated submission failures.
 * @param failureCount - number of failed submissions observed in the window
 * @param windowMin - observation window in minutes
 * @returns alert payload when failures >= threshold, else null
 */
export function checkSubmissionFailures(
  failureCount: number,
  windowMin: number = SUBMISSION_FAILURE_WINDOW_MIN
): AlertPayload | null {
  if (failureCount < SUBMISSION_FAILURE_THRESHOLD) return null;
  return {
    type: 'CHAIN_SUBMISSION_FAILURES',
    message: `Chain submission failures: ${failureCount} failures in the last ${windowMin} minutes (threshold ${SUBMISSION_FAILURE_THRESHOLD}).`,
    shipmentId: 'chain',
  };
}

/**
 * Unknown contract error codes (spec drift).
 * @param contractCode - raw u32 contract error discriminant
 * @param functionName - contract function that produced the error
 * @returns alert when the code is not in the spec, else null
 */
export function checkUnknownContractError(
  contractCode: number,
  functionName: string
): AlertPayload | null {
  const knownCodes = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
  if (knownCodes.has(contractCode)) return null;
  return {
    type: 'CHAIN_SPEC_DRIFT',
    message: `Chain spec drift: contract function "${functionName}" returned unknown error code ${contractCode}. Update src/shared/types/chain.ts CHAIN_CONTRACT_ERRORS and ErrorCodes registry.`,
    shipmentId: 'chain',
  };
}

/**
 * Indexer cursor stalled.
 * @param lastCursorAt - ISO timestamp of the last indexed cursor, or undefined
 * @param now - current time (injectable for tests)
 * @returns alert when the cursor is stalled beyond the threshold, else null
 */
export function checkIndexerCursorStalled(
  lastCursorAt: string | undefined,
  now: Date = new Date()
): AlertPayload | null {
  if (!lastCursorAt) return null;
  const last = new Date(lastCursorAt);
  if (isNaN(last.getTime())) return null;
  const stalledMin = (now.getTime() - last.getTime()) / 60_000;
  if (stalledMin < INDEXER_STALLED_THRESHOLD_MIN) return null;
  return {
    type: 'CHAIN_INDEXER_STALLED',
    message: `Indexer cursor stalled: last cursor at ${lastCursorAt} is ${Math.round(stalledMin)} minutes old (threshold ${INDEXER_STALLED_THRESHOLD_MIN} min).`,
    shipmentId: 'chain',
  };
}

/**
 * Reconciliation mismatch.
 * @param alert - reconciliation alert produced by reconcileEscrowEvent
 * @returns alert payload forwarding the mismatch
 */
export function checkReconciliationMismatch(alert: {
  type: 'ESCROW_AMOUNT_MISMATCH';
  message: string;
  paymentId: string;
  shipmentId: string;
  chainAmountStroops: string;
  dbAmountStroops: string;
}): AlertPayload | null {
  return {
    type: 'CHAIN_RECONCILIATION_MISMATCH',
    message: `Escrow reconciliation mismatch for payment ${alert.paymentId}: ${alert.message}`,
    shipmentId: alert.shipmentId,
  };
}

/**
 * Low channel-account balance.
 * @param balanceStroops - channel account native balance in stroops
 * @returns alert when balance < threshold, else null
 */
export function checkChannelLowBalance(balanceStroops: bigint): AlertPayload | null {
  if (balanceStroops >= CHANNEL_LOW_BALANCE_THRESHOLD_STROOPS) return null;
  return {
    type: 'CHAIN_LOW_BALANCE',
    message: `Channel account low balance: ${balanceStroops.toString()} stroops (${Number(balanceStroops) / 1e7} XLM) below threshold ${CHANNEL_LOW_BALANCE_THRESHOLD_STROOPS.toString()} stroops (1,000 XLM). Fund the channel account before the next escrow operation.`,
    shipmentId: 'chain',
  };
}

/**
 * Dead-letter growth.
 * @param failedJobCount - number of failed / dead-letter jobs in the queue
 * @returns alert when failed jobs >= threshold, else null
 */
export function checkDeadLetterGrowth(failedJobCount: number): AlertPayload | null {
  if (failedJobCount < DEAD_LETTER_THRESHOLD) return null;
  return {
    type: 'CHAIN_DEAD_LETTER_GROWTH',
    message: `Dead-letter growth: ${failedJobCount} failed jobs in the BullMQ queue (threshold ${DEAD_LETTER_THRESHOLD}). Investigate the failed-jobs queue before backlog compounds.`,
    shipmentId: 'chain',
  };
}
