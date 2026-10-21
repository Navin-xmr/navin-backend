/**
 * Socket.io Event Payload Types
 * Centralized TypeScript definitions for all socket events emitted by the server.
 * These types ensure type-safety for frontend consumers and maintain consistency
 * across all real-time communications.
 */

/**
 * Telemetry / Location Update Payload
 * Emitted as `location:update` when new telemetry data is received from IoT sensors.
 */
export interface TelemetryUpdatePayload {
  telemetryId: string;
  shipmentId: string;
  sensorId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: string; // ISO 8601 UTC
  dataHash: string;
  anchorStatus: 'PENDING_ANCHOR' | 'ANCHORED' | 'ANCHOR_FAILED';
  stellarTxHash?: string;
}

/**
 * Anomaly Alert Payload
 * Emitted as `anomaly:detected` when an anomaly is detected in shipment telemetry.
 */
export interface AnomalyAlertPayload {
  anomalyId: string;
  shipmentId: string;
  type:
    | 'TEMPERATURE_EXCEEDED'
    | 'TEMPERATURE_BELOW_MIN'
    | 'HUMIDITY_EXCEEDED'
    | 'HUMIDITY_BELOW_MIN'
    | 'BATTERY_LOW';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  timestamp: string; // ISO 8601 UTC
  resolved: boolean;
}

/**
 * Shipment Status Payload
 * Emitted as `shipment:status` when a shipment status changes.
 */
export interface StatusUpdatePayload {
  shipmentId: string;
  status:
    | 'CREATED'
    | 'PICKUP_CONFIRMED'
    | 'IN_TRANSIT'
    | 'CUSTOMS_CLEARED'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'SETTLEMENT_INITIATED'
    | 'SETTLEMENT_COMPLETED'
    | 'CANCELLED';
  milestones?: Array<{
    name: string;
    timestamp: string | Date;
    description?: string | null;
    userId?: string | null;
    walletAddress?: string | null;
  }>;
  updatedAt?: string | Date;
}

/**
 * Settlement Status Payload
 * Emitted as `settlement:status` when a payment / escrow status changes for a shipment.
 * `txHash` carries the Stellar transaction hash when the status transition is on-chain.
 */
export interface SettlementStatusPayload {
  paymentId: string;
  shipmentId: string;
  oldStatus: string;
  newStatus: string;
  amount: number;
  txHash?: string; // Stellar tx hash – present when status transition is on-chain
  timestamp: string; // ISO 8601 UTC
}

/**
 * Notification Payload
 * Emitted as `notification:new` for user-scoped notifications (anomaly alerts, system
 * messages, milestone updates, etc.).
 */
export interface NotificationPayload {
  notificationId: string;
  recipientId: string; // userId or organizationId
  type: string; // e.g. 'ANOMALY_ALERT' | 'MILESTONE' | 'SYSTEM'
  title: string;
  body: string;
  referenceId?: string; // shipmentId, paymentId, etc.
  referenceType?: string; // e.g. 'SHIPMENT' | 'PAYMENT'
  timestamp: string; // ISO 8601 UTC
  read: boolean;
}

/**
 * Socket Event Map
 * Defines all available socket events and their corresponding payload types.
 * Keys must match the string literals emitted in `src/infra/socket/io.ts`.
 */
export interface SocketEventMap {
  'location:update': TelemetryUpdatePayload;
  'anomaly:detected': AnomalyAlertPayload;
  'shipment:status': StatusUpdatePayload;
  'settlement:status': SettlementStatusPayload;
  'notification:new': NotificationPayload;
}

/**
 * Type-safe socket event emitter helpers.
 */
export type SocketEventName = keyof SocketEventMap;
export type SocketEventPayload<T extends SocketEventName> = SocketEventMap[T];

/**
 * Canonical event-name constants for all live Socket.IO / SSE events.
 *
 * Always reference these constants instead of inline string literals so that
 * a rename requires an intentional, grep-visible update to both the constant
 * and any test / client that references it.
 *
 * `satisfies` keeps these literals in lock-step with `SocketEventMap`, so an
 * emitter, the SSE fan-out and any test suite that imports the constant cannot
 * drift onto a stale (or invented) event name.
 *
 * Dead names (telemetry_update, payment_status_changed) are NOT included here
 * and must never be reintroduced.
 */
export const SOCKET_EVENTS = {
  LOCATION_UPDATE: 'location:update',
  ANOMALY_DETECTED: 'anomaly:detected',
  SHIPMENT_STATUS: 'shipment:status',
  SETTLEMENT_STATUS: 'settlement:status',
  NOTIFICATION_NEW: 'notification:new',
} as const satisfies Record<string, SocketEventName>;

/**
 * Event names retired when the protocol moved to colon-separated namespaces.
 * Referenced by test suites to prove the legacy literals are not reintroduced.
 */
export const RETIRED_SOCKET_EVENT_NAMES: readonly string[] = [
  'telemetry_update',
  'anomaly_detected',
  'status_update',
  'payment_status_changed',
];

/** @deprecated Use `SettlementStatusPayload` */
export type PaymentStatusPayload = SettlementStatusPayload;
