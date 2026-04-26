/**
 * Socket.io Event Payload Types
 * Centralized TypeScript definitions for all socket events emitted by the server.
 * These types ensure type-safety for frontend consumers and maintain consistency
 * across all real-time communications.
 */

/**
 * Telemetry Update Payload
 * Emitted when new telemetry data is received from IoT sensors
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
 * Emitted when an anomaly is detected in shipment telemetry
 */
export interface AnomalyAlertPayload {
  anomalyId: string;
  shipmentId: string;
  type: 'TEMPERATURE_EXCEEDED' | 'TEMPERATURE_BELOW_MIN' | 'HUMIDITY_EXCEEDED' | 'HUMIDITY_BELOW_MIN' | 'BATTERY_LOW';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  timestamp: string; // ISO 8601 UTC
  resolved: boolean;
}

/**
 * Status Update Payload
 * Emitted when a shipment status changes
 */
export interface StatusUpdatePayload {
  shipmentId: string;
  status: 'CREATED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
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
 * Socket Event Map
 * Defines all available socket events and their corresponding payload types
 */
export interface SocketEventMap {
  telemetry_update: TelemetryUpdatePayload;
  anomaly_detected: AnomalyAlertPayload;
  status_update: StatusUpdatePayload;
}

/**
 * Type-safe socket event emitter helper
 * Use this to ensure type-checking when emitting events
 */
export type SocketEventName = keyof SocketEventMap;
export type SocketEventPayload<T extends SocketEventName> = SocketEventMap[T];
