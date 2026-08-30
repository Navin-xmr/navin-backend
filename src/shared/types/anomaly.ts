export const ANOMALY_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

export const ANOMALY_TYPES = [
  'TEMPERATURE_EXCEEDED',
  'TEMPERATURE_BELOW_MIN',
  'HUMIDITY_EXCEEDED',
  'HUMIDITY_BELOW_MIN',
  'BATTERY_LOW',
] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export interface IAnomaly {
  _id: string;
  shipmentId: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNote?: string;
  createdAt: Date;
  updatedAt: Date;
}
