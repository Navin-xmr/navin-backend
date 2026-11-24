import { describe, expect, it, jest } from '@jest/globals';

import {
  buildIdempotencyKey,
  ReceiptCache,
} from '../src/services/chain/idempotency.js';
import {
  backoffDelayMs,
  isRetryableChainError,
  retryWithBackoff,
} from '../src/services/chain/retry.js';
import { AppError, ErrorCodes } from '../src/shared/http/errors.js';

const SHIPMENT = '65f1a2b3c4d5e6f708192a3b';
const timeout = () => new AppError(504, 'timed out', ErrorCodes.CHAIN_SUBMISSION_TIMEOUT);

describe('buildIdempotencyKey (#1078)', () => {
  const base = { shipmentId: SHIPMENT, eventType: 'anchor', eventCounter: 3 };

  it('is a deterministic 64-char lowercase hex digest', () => {
    const key = buildIdempotencyKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(buildIdempotencyKey({ ...base })).toBe(key);
  });

  it('changes when any of shipment_id, event_type or event_counter changes', () => {
    const key = buildIdempotencyKey(base);
    expect(buildIdempotencyKey({ ...base, shipmentId: 'other' })).not.toBe(key);
    expect(buildIdempotencyKey({ ...base, eventType: 'release' })).not.toBe(key);
    expect(buildIdempotencyKey({ ...base, eventCounter: 4 })).not.toBe(key);
  });

  it('does not collide when parts shift across the boundary', () => {
    expect(buildIdempotencyKey({ shipmentId: 'a|b', eventType: 'c', eventCounter: 1 })).not.toBe(
      buildIdempotencyKey({ shipmentId: 'a', eventType: 'b|c', eventCounter: 1 })
    );
  });

  it.each([
    ['empty shipment id', { ...base, shipmentId: '' }],
    ['empty event type', { ...base, eventType: '' }],
    ['negative counter', { ...base, eventCounter: -1 }],
    ['fractional counter', { ...base, eventCounter: 1.5 }],
    ['NaN counter', { ...base, eventCounter: Number.NaN }],
  ])('rejects %s with ERR_CHAIN_INVALID_IDEMPOTENCY_KEY', (_name, parts) => {
    expect(() => buildIdempotencyKey(parts)).toThrow(
      expect.objectContaining({ code: ErrorCodes.CHAIN_INVALID_IDEMPOTENCY_KEY, statusCode: 422 })
    );
  });
});

describe('ReceiptCache', () => {
  it('returns stored receipts and evicts the oldest beyond its bound', () => {
    const cache = new ReceiptCache(2);
    const receipt = (n: number) => ({ txHash: String(n).repeat(64), ledger: n, simulated: false });
    cache.set('a', receipt(1));
    cache.set('b', receipt(2));
    cache.set('c', receipt(3));

    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toEqual(receipt(3));
  });
});

describe('backoffDelayMs', () => {
  const policy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1000 };

  it('doubles each retry and is capped at maxDelayMs (full-jitter ceiling)', () => {
    expect([1, 2, 3, 4, 5].map(retry => backoffDelayMs(retry, policy, () => 1))).toEqual([
      100, 200, 400, 800, 1000,
    ]);
  });

  it('jitters into the upper half of the delay', () => {
    expect(backoffDelayMs(2, policy, () => 0)).toBe(100);
    expect(backoffDelayMs(2, policy, () => 1)).toBe(200);
  });
});

describe('isRetryableChainError', () => {
  it('retries only submission timeouts', () => {
    expect(isRetryableChainError(timeout())).toBe(true);
    expect(isRetryableChainError(new AppError(409, 'x', ErrorCodes.CHAIN_ALREADY_ANCHORED))).toBe(
      false
    );
    expect(isRetryableChainError(new Error('boom'))).toBe(false);
  });
});

describe('retryWithBackoff', () => {
  const policy = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 };

  it('returns the first success without waiting', async () => {
    const sleep = jest.fn(async () => undefined);
    await expect(retryWithBackoff(async () => 'ok', { policy, sleep })).resolves.toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries timeouts with exponential backoff until one succeeds', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    const onRetry = jest.fn();
    const operation = jest
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce('done');

    const result = await retryWithBackoff(operation, { policy, sleep, onRetry, random: () => 1 });

    expect(result).toBe('done');
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('is bounded: rethrows the last timeout after maxAttempts', async () => {
    const sleep = jest.fn(async () => undefined);
    const operation = jest.fn(async () => {
      throw timeout();
    });

    await expect(retryWithBackoff(operation, { policy, sleep })).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_SUBMISSION_TIMEOUT,
    });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry errors that are not retryable', async () => {
    const operation = jest.fn(async () => {
      throw new AppError(409, 'exists', ErrorCodes.CHAIN_ESCROW_EXISTS);
    });
    await expect(retryWithBackoff(operation, { policy, sleep: async () => undefined })).rejects.toMatchObject(
      { code: ErrorCodes.CHAIN_ESCROW_EXISTS }
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('treats maxAttempts of 1 as no retry', async () => {
    const operation = jest.fn(async () => {
      throw timeout();
    });
    await expect(
      retryWithBackoff(operation, { policy: { ...policy, maxAttempts: 1 } })
    ).rejects.toBeInstanceOf(AppError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
