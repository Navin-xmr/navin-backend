/**
 * Bounded retry with exponential backoff for chain submissions (#1078).
 */
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

export interface RetryPolicy {
  /** Total attempts including the first (>= 1). */
  maxAttempts: number;
  /** Delay before the first retry, in ms. Doubles on each further retry. */
  baseDelayMs: number;
  /** Upper bound for any single delay, in ms. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
};

/**
 * Delay before retry number `retry` (1 = first retry): `base * 2^(retry-1)`
 * capped at `maxDelayMs`, then jittered into [50%, 100%] so concurrent
 * workers do not retry in lockstep.
 */
export function backoffDelayMs(
  retry: number,
  policy: RetryPolicy,
  random: () => number = Math.random
): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, retry - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  return Math.round(capped * (0.5 + random() * 0.5));
}

/** Only submission timeouts are retried; contract and validation errors are final. */
export function isRetryableChainError(err: unknown): boolean {
  return err instanceof AppError && err.code === ErrorCodes.CHAIN_SUBMISSION_TIMEOUT;
}

export interface RetryOptions {
  policy?: RetryPolicy;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Run `operation(attempt)` up to `policy.maxAttempts` times. Rethrows the last
 * error once attempts run out or `shouldRetry` says the error is final.
 */
export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const shouldRetry = options.shouldRetry ?? isRetryableChainError;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error)) throw error;
      const delayMs = backoffDelayMs(attempt, policy, options.random);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
