import type { TelemetryThresholds } from '../../services/anomaly.service.js';

export const DEFAULT_SHIPMENT_TYPE = 'DEFAULT';

export const DEFAULT_TELEMETRY_THRESHOLDS: Required<
  Pick<TelemetryThresholds, 'maxTemp' | 'maxHumidity' | 'minBatteryLevel'>
> = {
  maxTemp: 25,
  maxHumidity: 80,
  minBatteryLevel: 20,
};
