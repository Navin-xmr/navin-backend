/**
 * Telemetry-based anomaly detection aligned with frontend anomaly types.
 * Detects TEMPERATURE_BREACH, HUMIDITY_BREACH, SHOCK_EVENT, GPS_LOST, BATTERY_LOW.
 * Writes isAnomaly and anomalyType directly to the telemetry record.
 */

import type { TelemetryAnomalyType } from '../shared/types/telemetry.js';
import { Telemetry } from '../modules/telemetry/telemetry.model.js';
import { logger } from '../shared/logger/logger.js';
import { resolveTelemetryThresholdsForShipment } from '../modules/telemetry/telemetryThreshold.service.js';
import { detectGpsLoss } from './gpsLossDetection.js';

export interface TelemetryAnomalyDetectionResult {
  isAnomaly: boolean;
  anomalyType?: TelemetryAnomalyType;
  details: string[];
}

/**
 * Detect anomalies from telemetry data and update the telemetry record with anomaly flags.
 * Returns the detected anomaly type and updates isAnomaly + anomalyType on the telemetry doc.
 *
 * @param telemetryId - ID of the telemetry record
 * @param shipmentId - Associated shipment
 * @param temperature - Temperature reading
 * @param humidity - Humidity reading
 * @param batteryLevel - Battery percentage
 * @param shockMagnitude - Optional shock acceleration (G-force)
 * @param latitude - GPS latitude
 * @param longitude - GPS longitude
 * @returns Detection result with anomaly type and details
 */
export async function detectTelemetryAnomalies(
  telemetryId: string,
  shipmentId: string,
  temperature: number,
  humidity: number,
  batteryLevel: number,
  shockMagnitude: number | undefined,
  latitude: number,
  longitude: number
): Promise<TelemetryAnomalyDetectionResult> {
  const details: string[] = [];
  let anomalyType: TelemetryAnomalyType | undefined;

  try {
    // Resolve thresholds for this shipment
    const thresholds = await resolveTelemetryThresholdsForShipment(shipmentId);

    // Check temperature breach (max or min)
    if (thresholds.maxTemp && temperature > thresholds.maxTemp) {
      anomalyType = 'TEMPERATURE_BREACH';
      details.push(`Temperature exceeded: ${temperature}°C > ${thresholds.maxTemp}°C`);
    } else if (thresholds.minTemp && temperature < thresholds.minTemp) {
      anomalyType = 'TEMPERATURE_BREACH';
      details.push(`Temperature below minimum: ${temperature}°C < ${thresholds.minTemp}°C`);
    }

    // Check humidity breach (max or min)
    if (!anomalyType) {
      if (thresholds.maxHumidity && humidity > thresholds.maxHumidity) {
        anomalyType = 'HUMIDITY_BREACH';
        details.push(`Humidity exceeded: ${humidity}% > ${thresholds.maxHumidity}%`);
      } else if (thresholds.minHumidity && humidity < thresholds.minHumidity) {
        anomalyType = 'HUMIDITY_BREACH';
        details.push(`Humidity below minimum: ${humidity}% < ${thresholds.minHumidity}%`);
      }
    }

    // Check shock event
    if (!anomalyType && shockMagnitude && shockMagnitude > 2) {
      // Shock threshold: > 2G is considered significant
      anomalyType = 'SHOCK_EVENT';
      details.push(`Shock detected: ${shockMagnitude}G`);
    }

    // Check battery low
    if (!anomalyType && thresholds.minBatteryLevel && batteryLevel < thresholds.minBatteryLevel) {
      anomalyType = 'BATTERY_LOW';
      details.push(`Battery low: ${batteryLevel}% < ${thresholds.minBatteryLevel}%`);
    }

    // Check GPS loss
    if (!anomalyType) {
      const gpsCheck = await detectGpsLoss(shipmentId, latitude, longitude);
      if (gpsCheck.hasGpsLoss) {
        anomalyType = 'GPS_LOST';
        details.push(`GPS signal lost for ${gpsCheck.consecutiveCount} consecutive readings`);
      }
    }

    const isAnomaly = anomalyType !== undefined;

    // Update telemetry record with anomaly flags
    if (isAnomaly) {
      await Telemetry.findByIdAndUpdate(
        telemetryId,
        {
          isAnomaly: true,
          anomalyType,
        },
        { new: false } // We don't need the updated doc
      );

      logger.info(
        { telemetryId, shipmentId, anomalyType, details },
        'Anomaly detected and recorded'
      );
    }

    return {
      isAnomaly,
      anomalyType,
      details,
    };
  } catch (error) {
    logger.error({ err: error, telemetryId, shipmentId }, 'Error detecting telemetry anomalies');

    return {
      isAnomaly: false,
      details: ['Error during anomaly detection'],
    };
  }
}
