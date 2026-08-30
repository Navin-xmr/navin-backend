export enum TelemetryAnchorStatus {
  PENDING_ANCHOR = 'PENDING_ANCHOR',
  ANCHORED = 'ANCHORED',
  ANCHOR_FAILED = 'ANCHOR_FAILED',
}

/**
 * Anomaly types aligned with frontend expectations.
 * TEMPERATURE_BREACH includes both exceeded and below-min conditions.
 * GPS_LOST is detected when consecutive readings lack coordinates.
 */
export const TELEMETRY_ANOMALY_TYPES = [
  'TEMPERATURE_BREACH',
  'HUMIDITY_BREACH',
  'SHOCK_EVENT',
  'GPS_LOST',
  'BATTERY_LOW',
] as const;

export type TelemetryAnomalyType = (typeof TELEMETRY_ANOMALY_TYPES)[number];

export interface ITelemetry {
  _id: string;
  sensorId?: string;
  shipmentId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: Date;
  dataHash: string;
  stellarTxHash?: string;
  anchorStatus: TelemetryAnchorStatus;
  anchorError?: string;
  rawPayload: Record<string, unknown>;

  // New fields for frontend anomaly alignment
  shockMagnitude?: number; // Acceleration magnitude (G-force units)
  isAnomaly?: boolean; // True if any anomaly detected on this record
  anomalyType?: TelemetryAnomalyType; // Primary anomaly type (if isAnomaly=true)

  createdAt: Date;
  updatedAt: Date;
}
