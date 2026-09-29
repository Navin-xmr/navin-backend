/**
 * Shared type definitions for the real-time events polling module.
 *
 * `RealtimeEvent` is the canonical shape stored in Redis and returned by
 * GET /api/events/poll.  It is a discriminated union keyed on `type` so
 * the frontend can narrow the payload with a simple switch/if check.
 */

import {
  SOCKET_EVENTS,
  type TelemetryUpdatePayload,
  type AnomalyAlertPayload,
  type StatusUpdatePayload,
  type SettlementStatusPayload,
} from '../../shared/types/socketEvents.js';

/** Epoch-milliseconds timestamp added by pushRecentEvent(). */
type WithPublishedAt = { publishedAt: number };

/**
 * Discriminants come from `SOCKET_EVENTS` so the polling payload cannot drift
 * away from the names the Socket.io/SSE emitters actually publish.
 */
export type RealtimeEvent =
  | ({ type: typeof SOCKET_EVENTS.TELEMETRY_UPDATE } & TelemetryUpdatePayload & WithPublishedAt)
  | ({ type: typeof SOCKET_EVENTS.ANOMALY_DETECTED } & AnomalyAlertPayload & WithPublishedAt)
  | ({ type: typeof SOCKET_EVENTS.SHIPMENT_STATUS } & StatusUpdatePayload & WithPublishedAt)
  | ({ type: typeof SOCKET_EVENTS.SETTLEMENT_STATUS } & SettlementStatusPayload & WithPublishedAt);
