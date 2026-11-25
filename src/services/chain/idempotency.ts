/**
 * Deterministic idempotency keys for chain submissions (#1078).
 *
 * A key identifies one logical on-chain event: the same
 * (shipment_id, event_type, event_counter) always yields the same key, so a
 * retry or a replayed job can be recognised as a duplicate instead of being
 * submitted twice.
 */
import { createHash } from 'node:crypto';

import { AppError, ErrorCodes } from '../../shared/http/errors.js';

import type { ChainTxReceipt } from './types.js';

export interface IdempotencyParts {
  shipmentId: string;
  eventType: string;
  eventCounter: number;
}

/**
 * SHA-256 hex of the JSON array `[shipmentId, eventType, eventCounter]`.
 * JSON encoding keeps the parts unambiguous (no delimiter collisions).
 * @throws {AppError} ERR_CHAIN_INVALID_IDEMPOTENCY_KEY for empty parts or a
 *   counter that is not a non-negative safe integer.
 */
export function buildIdempotencyKey(parts: IdempotencyParts): string {
  const { shipmentId, eventType, eventCounter } = parts;
  if (typeof shipmentId !== 'string' || shipmentId.length === 0) {
    throw invalid('shipment_id must be a non-empty string');
  }
  if (typeof eventType !== 'string' || eventType.length === 0) {
    throw invalid('event_type must be a non-empty string');
  }
  if (!Number.isSafeInteger(eventCounter) || eventCounter < 0) {
    throw invalid('event_counter must be a non-negative integer');
  }
  return createHash('sha256')
    .update(JSON.stringify([shipmentId, eventType, eventCounter]))
    .digest('hex');
}

function invalid(message: string): AppError {
  return new AppError(422, message, ErrorCodes.CHAIN_INVALID_IDEMPOTENCY_KEY);
}

/**
 * Bounded in-memory record of completed submissions, keyed by idempotency key.
 * Oldest entries are evicted first. It lives for the process; a restart relies
 * on the on-chain duplicate check instead.
 */
export class ReceiptCache {
  private readonly entries = new Map<string, ChainTxReceipt>();

  constructor(private readonly maxEntries = 1000) {}

  get(key: string): ChainTxReceipt | undefined {
    return this.entries.get(key);
  }

  set(key: string, receipt: ChainTxReceipt): void {
    this.entries.delete(key);
    this.entries.set(key, receipt);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
