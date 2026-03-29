import type { AnomalySeverity, AnomalyType } from '../modules/anomaly/anomaly.model.js';

export interface TelemetryPayload {
  shipmentId: string;
  timestamp: Date;
  temperature?: number | null;
  humidity?: number | null;
  batteryLevel?: number | null;
}

export interface TelemetryThresholds {
  maxTemp?: number | null;
  minTemp?: number | null;
  maxHumidity?: number | null;
  minHumidity?: number | null;
  minBatteryLevel?: number | null;
}

export interface EvaluatedAnomaly {
  shipmentId: string;
  timestamp: Date;
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  resolved: false;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function batterySeverity(batteryLevel: number, minBatteryLevel: number): AnomalySeverity {
  // Deterministic severity heuristic: more severe the further below the threshold.
  if (batteryLevel < Math.max(0, minBatteryLevel * 0.5)) return 'HIGH';
  if (batteryLevel < minBatteryLevel) return 'MEDIUM';
  return 'LOW';
}

export function evaluateTelemetry(
  payload: TelemetryPayload,
  thresholds: TelemetryThresholds
): EvaluatedAnomaly[] {
  const anomalies: EvaluatedAnomaly[] = [];

  const { shipmentId, timestamp } = payload;
  if (!shipmentId || !(timestamp instanceof Date) || Number.isNaN(timestamp.getTime()))
    return anomalies;

  const temperature = payload.temperature;
  const humidity = payload.humidity;
  const batteryLevel = payload.batteryLevel;

  if (isFiniteNumber(temperature)) {
    if (isFiniteNumber(thresholds.maxTemp) && temperature > thresholds.maxTemp) {
      anomalies.push({
        shipmentId,
        timestamp,
        type: 'TEMPERATURE_EXCEEDED',
        severity: 'HIGH',
        message: `Temperature exceeded max threshold: ${temperature} > ${thresholds.maxTemp}`,
        resolved: false,
      });
    }

    if (isFiniteNumber(thresholds.minTemp) && temperature < thresholds.minTemp) {
      anomalies.push({
        shipmentId,
        timestamp,
        type: 'TEMPERATURE_BELOW_MIN',
        severity: 'HIGH',
        message: `Temperature fell below min threshold: ${temperature} < ${thresholds.minTemp}`,
        resolved: false,
      });
    }
  }

  if (isFiniteNumber(humidity)) {
    if (isFiniteNumber(thresholds.maxHumidity) && humidity > thresholds.maxHumidity) {
      anomalies.push({
        shipmentId,
        timestamp,
        type: 'HUMIDITY_EXCEEDED',
        severity: 'HIGH',
        message: `Humidity exceeded max threshold: ${humidity} > ${thresholds.maxHumidity}`,
        resolved: false,
      });
    }

    if (isFiniteNumber(thresholds.minHumidity) && humidity < thresholds.minHumidity) {
      anomalies.push({
        shipmentId,
        timestamp,
        type: 'HUMIDITY_BELOW_MIN',
        severity: 'HIGH',
        message: `Humidity fell below min threshold: ${humidity} < ${thresholds.minHumidity}`,
        resolved: false,
      });
    }
  }

  if (
    isFiniteNumber(batteryLevel) &&
    isFiniteNumber(thresholds.minBatteryLevel) &&
    batteryLevel < thresholds.minBatteryLevel
  ) {
    anomalies.push({
      shipmentId,
      timestamp,
      type: 'BATTERY_LOW',
      severity: batterySeverity(batteryLevel, thresholds.minBatteryLevel),
      message: `Battery level below threshold: ${batteryLevel} < ${thresholds.minBatteryLevel}`,
      resolved: false,
    });
  }

  return anomalies;
}
