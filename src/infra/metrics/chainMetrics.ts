/**
 * Chain observability metrics (#1044) — Prometheus, low-cardinality by construction.
 *
 * Label policy (hard rule): every label value comes from a CLOSED set defined in this file
 * (`CHAIN_OPERATIONS`, `ChainErrorLabel`, `QUEUE_NAMES`, `QUEUE_STATES`, chain event names,
 * `network`). Shipment ids, tx hashes, wallet addresses, user ids and raw error messages are
 * never accepted as label values — the helpers below take enums, not strings, and unknown
 * errors collapse into `ERR_OTHER` / `ERR_UNCLASSIFIED`.
 *
 * Metric names follow Prometheus conventions: `navin_` prefix, base units in the suffix
 * (`_seconds`), `_total` for counters.
 *
 * Instrumentation must never disturb the pipeline it observes: every recording helper
 * swallows its own errors.
 */
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

import { config } from '../../config/index.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { CHAIN_EVENT_NAMES } from '../../shared/types/chain.js';

/** Chain operations that submit a transaction (closed set). */
export const CHAIN_OPERATIONS = ['anchor_event', 'release_escrow'] as const;
export type ChainOperation = (typeof CHAIN_OPERATIONS)[number];

export const QUEUE_NAMES = ['transaction_queue', 'stellar_indexer_queue'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

const KNOWN_CHAIN_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(ErrorCodes).filter(code => code.startsWith('ERR_CHAIN_'))
);

/** `ERR_CHAIN_*` registry codes, plus two catch-all buckets. */
export type ChainErrorLabel = string;

/**
 * Collapses any thrown value into a bounded label: a registered `ERR_CHAIN_*` code,
 * `ERR_OTHER` (an AppError with a non-chain code) or `ERR_UNCLASSIFIED` (anything else).
 * The error message is never inspected.
 */
export function normalizeChainError(err: unknown): ChainErrorLabel {
  if (err instanceof AppError) {
    return KNOWN_CHAIN_ERROR_CODES.has(err.code) ? err.code : 'ERR_OTHER';
  }
  return 'ERR_UNCLASSIFIED';
}

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ network: config.stellarNetwork });

const submissionsTotal = new Counter({
  name: 'navin_chain_submissions_total',
  help: 'Chain transaction submissions by operation and outcome.',
  labelNames: ['operation', 'outcome'] as const,
  registers: [metricsRegistry],
});

const submissionFailuresTotal = new Counter({
  name: 'navin_chain_submission_failures_total',
  help: 'Failed chain submissions by operation and normalized error code.',
  labelNames: ['operation', 'error_code'] as const,
  registers: [metricsRegistry],
});

const submissionDuration = new Histogram({
  name: 'navin_chain_submission_duration_seconds',
  help: 'Wall-clock time of a chain submission (build, simulate, sign, send, confirm).',
  labelNames: ['operation', 'outcome'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60],
  registers: [metricsRegistry],
});

const confirmationLag = new Histogram({
  name: 'navin_chain_confirmation_lag_seconds',
  help: 'Seconds from the chain event timestamp (ledger close) to successful verification.',
  labelNames: ['event'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [metricsRegistry],
});

const lastPollTimestamp = new Gauge({
  name: 'navin_indexer_last_poll_timestamp_seconds',
  help: 'Unix time the indexer last completed a polling cycle successfully.',
  registers: [metricsRegistry],
});

// ─── Scrape-time gauges ──────────────────────────────────────────────────────

let cursorEventAtMs: number | undefined;

new Gauge({
  name: 'navin_indexer_cursor_age_seconds',
  help:
    'Age of the last event the indexer processed (now minus its ledger close time). ' +
    'Grows on a quiet chain; alert together with navin_indexer_last_poll_timestamp_seconds.',
  registers: [metricsRegistry],
  collect() {
    // NaN (unknown) rather than a false 0 ("fresh") before any event has been seen.
    this.set(
      cursorEventAtMs === undefined ? NaN : Math.max(0, (Date.now() - cursorEventAtMs) / 1000)
    );
  },
});

export type QueueDepths = Partial<Record<QueueName, Partial<Record<QueueState, number>>>>;
let queueDepthProvider: (() => Promise<QueueDepths>) | undefined;

/** Registers the (async) source of queue depths, evaluated on every scrape. */
export function setQueueDepthProvider(provider: () => Promise<QueueDepths>): void {
  queueDepthProvider = provider;
}

new Gauge({
  name: 'navin_chain_queue_depth',
  help: 'Jobs in a chain-related BullMQ queue by state.',
  labelNames: ['queue', 'state'] as const,
  registers: [metricsRegistry],
  async collect() {
    if (!queueDepthProvider) return;
    try {
      const depths = await queueDepthProvider();
      this.reset();
      for (const queue of QUEUE_NAMES) {
        for (const state of QUEUE_STATES) {
          const value = depths[queue]?.[state];
          if (typeof value === 'number') this.set({ queue, state }, value);
        }
      }
    } catch {
      // Redis unavailable: leave the gauge unset rather than report a false zero.
      this.reset();
    }
  },
});

// ─── Recording helpers (never throw) ─────────────────────────────────────────

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* metrics must never break the pipeline */
  }
}

/**
 * Times a chain submission and records success/failure. The original result or error is
 * returned/rethrown untouched.
 */
export async function instrumentSubmission<T>(
  operation: ChainOperation,
  submit: () => Promise<T>
): Promise<T> {
  const startedAt = process.hrtime.bigint();
  const seconds = () => Number(process.hrtime.bigint() - startedAt) / 1e9;
  try {
    const result = await submit();
    safely(() => {
      submissionsTotal.inc({ operation, outcome: 'success' });
      submissionDuration.observe({ operation, outcome: 'success' }, seconds());
    });
    return result;
  } catch (err) {
    safely(() => {
      submissionsTotal.inc({ operation, outcome: 'failure' });
      submissionFailuresTotal.inc({ operation, error_code: normalizeChainError(err) });
      submissionDuration.observe({ operation, outcome: 'failure' }, seconds());
    });
    throw err;
  }
}

const CHAIN_EVENT_LABELS: ReadonlySet<string> = new Set(Object.values(CHAIN_EVENT_NAMES));

/** Records confirmation lag for a chain event; ignores unknown event names and bad timestamps. */
export function observeConfirmationLag(
  eventName: string,
  eventTime: Date | string | undefined,
  now: Date = new Date()
): void {
  safely(() => {
    if (!eventTime || !CHAIN_EVENT_LABELS.has(eventName)) return;
    const lagMs = now.getTime() - new Date(eventTime).getTime();
    if (!Number.isFinite(lagMs)) return;
    confirmationLag.observe({ event: eventName }, Math.max(0, lagMs / 1000));
  });
}

/** Marks the newest processed event's ledger close time (drives `cursor_age_seconds`). */
export function recordIndexerCursorEvent(eventTime: Date | string | undefined): void {
  safely(() => {
    if (!eventTime) return;
    const ms = new Date(eventTime).getTime();
    if (Number.isFinite(ms) && (cursorEventAtMs === undefined || ms > cursorEventAtMs)) {
      cursorEventAtMs = ms;
    }
  });
}

/** Marks a successful indexer polling cycle. */
export function recordIndexerPoll(now: Date = new Date()): void {
  safely(() => lastPollTimestamp.set(now.getTime() / 1000));
}

/** Test seam. */
export function resetChainMetricsForTests(): void {
  cursorEventAtMs = undefined;
  queueDepthProvider = undefined;
  metricsRegistry.resetMetrics();
}
