/**
 * GPS loss detection logic.
 * Flags shipments that have N consecutive telemetry readings without valid GPS coordinates.
 */

import { Telemetry } from '../modules/telemetry/telemetry.model.js';
import { logger } from '../shared/logger/logger.js';

/**
 * Consecutive readings threshold before flagging GPS loss anomaly.
 * If 3+ consecutive readings lack valid lat/lng, it's considered GPS_LOST.
 */
export const GPS_LOSS_THRESHOLD = 3;

/**
 * Check if coordinates are valid.
 * Returns false if missing, null, or NaN.
 */
function hasValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0 // Both 0,0 is unlikely to be a real reading
  );
}

/**
 * Detect GPS loss by checking recent telemetry records.
 * Returns the anomaly type (GPS_LOST or null) and the count of consecutive missing coordinates.
 *
 * @param shipmentId - The shipment to check
 * @param currentLat - Current reading latitude
 * @param currentLng - Current reading longitude
 * @returns { hasGpsLoss: boolean; consecutiveCount: number }
 */
export async function detectGpsLoss(
  shipmentId: string,
  currentLat: number,
  currentLng: number
): Promise<{ hasGpsLoss: boolean; consecutiveCount: number }> {
  try {
    // Fetch the last N+1 telemetry records (to get N readings before current)
    const recentRecords = await Telemetry.find({ shipmentId })
      .sort({ timestamp: -1 })
      .limit(GPS_LOSS_THRESHOLD + 1)
      .select({ latitude: 1, longitude: 1, timestamp: 1 })
      .lean();

    if (recentRecords.length < GPS_LOSS_THRESHOLD) {
      // Not enough history yet
      return { hasGpsLoss: false, consecutiveCount: 0 };
    }

    // Count consecutive missing coordinates from most recent backwards
    let consecutiveCount = 0;

    // Check current reading
    if (!hasValidCoordinates(currentLat, currentLng)) {
      consecutiveCount = 1;
    } else {
      // Current reading is valid; no GPS loss
      return { hasGpsLoss: false, consecutiveCount: 0 };
    }

    // Check previous records
    for (const record of recentRecords) {
      if (!hasValidCoordinates(record.latitude, record.longitude)) {
        consecutiveCount++;
        if (consecutiveCount >= GPS_LOSS_THRESHOLD) {
          logger.warn(
            { shipmentId, consecutiveCount },
            `GPS loss detected: ${consecutiveCount} consecutive missing readings`
          );
          return { hasGpsLoss: true, consecutiveCount };
        }
      } else {
        // Found a valid reading; break streak
        break;
      }
    }

    return { hasGpsLoss: false, consecutiveCount };
  } catch (error) {
    logger.error({ err: error, shipmentId }, 'Error detecting GPS loss');
    return { hasGpsLoss: false, consecutiveCount: 0 };
  }
}
