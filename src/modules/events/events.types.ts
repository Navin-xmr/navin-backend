/**
 * Shared type definitions for the real-time events polling module.
 *
 * `RealtimeEvent` is the canonical shape stored in Redis and returned by
 * GET /api/events/poll.  It is a discriminated union keyed on `type` so
 * the frontend can narrow the payload with a simple switch/if check.
 */

import type {
  TelemetryUpdatePayload,
  AnomalyAlertPayload,
  StatusUpdatePayload,
  PaymentStatusPayload,
} from '../../shared/types/socketEvents.js';

/** Epoch-milliseconds timestamp added by pushRecentEvent(). */
type WithPublishedAt = { publishedAt: number };

export type RealtimeEvent =
  | ({ type: 'telemetry_update' } & TelemetryUpdatePayload & WithPublishedAt)
  | ({ type: 'anomaly_detected' } & AnomalyAlertPayload & WithPublishedAt)
  | ({ type: 'status_update' } & StatusUpdatePayload & WithPublishedAt)
  | ({ type: 'payment_status_changed' } & PaymentStatusPayload & WithPublishedAt);
