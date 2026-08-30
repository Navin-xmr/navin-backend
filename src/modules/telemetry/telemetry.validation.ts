import { z } from 'zod';

const utcDateString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/,
    'Date must be a UTC ISO 8601 string (e.g. 2026-01-01T00:00:00.000Z)'
  )
  .transform(s => new Date(s));

/**
 * Query schema for `GET /api/telemetry`.
 *
 * Business domain: cold-chain / IoT telemetry time-series for shipments.
 * Used by dashboard clients (often page-based) and machine clients that prefer
 * cursor pagination for large chronological datasets (see docs/PAGINATION.md).
 *
 * Constraints exist so clients cannot mix incompatible pagination modes or
 * request inverted date windows that would return empty or nonsensical ranges.
 */
export const TelemetryQuerySchema = z
  .object({
    cursor: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    shipmentId: z.string().trim().optional(),
    from: utcDateString.optional(),
    to: utcDateString.optional(),
  })
  // Cursor and page use different meta shapes (nextCursor/hasMore vs page in meta).
  // Allowing both would make the response ambiguous and break frontend vs IoT client contracts.
  .refine(data => !(data.cursor && data.page !== undefined), {
    message: 'Use either cursor or page for pagination, not both.',
  })
  // An inverted from/to window cannot describe a valid observation period and would
  // waste DB work while returning empty results that look like "no telemetry".
  .refine(data => !(data.from && data.to && data.from > data.to), {
    message: 'from must be <= to',
  });

const BulkTelemetryItemSchema = z.object({
  shipmentId: z.string().trim().min(1),
  temperature: z.number().min(-50).max(100),
  humidity: z.number(),
  latitude: z.number(),
  longitude: z.number(),
  batteryLevel: z.number().min(0).max(100),
  timestamp: z.coerce.date(),
  sensorId: z.string().trim().optional(),
});

/**
 * Body schema for `POST /api/telemetry/bulk`.
 *
 * Business domain: authenticated batch ingest of sensor readings (JWT path;
 * single-reading IoT devices typically use `POST /api/webhooks/iot` with an API key).
 *
 * Batch size is capped (1–1000) to bound write amplification, anomaly evaluation,
 * and Stellar anchoring work per request.
 */
export const BulkTelemetryBodySchema = z.object({
  items: z.array(BulkTelemetryItemSchema).min(1).max(1000),
});

export type BulkTelemetryItem = z.infer<typeof BulkTelemetryItemSchema>;
export type BulkTelemetryBody = z.infer<typeof BulkTelemetryBodySchema>;

/**
 * Shape of threshold values returned/stored for anomaly detection.
 *
 * Business domain: organization (and optional shipment-type) limits that flag
 * temperature, humidity, and battery anomalies during telemetry ingest.
 */
export const TelemetryThresholdsSchema = z.object({
  maxTemp: z.number(),
  maxHumidity: z.number(),
  minBatteryLevel: z.number(),
});

export type TelemetryThresholds = z.infer<typeof TelemetryThresholdsSchema>;

/**
 * Query schema for `GET /api/telemetry/thresholds`.
 *
 * Business domain: resolve which shipment-type threshold profile to load.
 * When omitted, the service falls back to the organization DEFAULT profile so
 * dashboards can show effective limits without knowing every category key.
 */
export const TelemetryThresholdsQuerySchema = z.object({
  shipmentType: z.string().trim().min(1).optional(),
});

/**
 * Body schema for `PUT /api/telemetry/thresholds`.
 *
 * Business domain: admin updates to anomaly thresholds. Nullable fields clear
 * an override so the org can revert a limit without inventing a sentinel number.
 * Optional shipmentType scopes the update to a category-specific profile.
 */
export const UpdateTelemetryThresholdsBodySchema = z.object({
  shipmentType: z.string().trim().min(1).optional(),
  maxTemp: z.number().nullable().optional(),
  minTemp: z.number().nullable().optional(),
  maxHumidity: z.number().nullable().optional(),
  minHumidity: z.number().nullable().optional(),
  minBatteryLevel: z.number().nullable().optional(),
});

export type UpdateTelemetryThresholdsInput = z.infer<typeof UpdateTelemetryThresholdsBodySchema>;
