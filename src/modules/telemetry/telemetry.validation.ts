import { z } from 'zod';

const utcDateString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/,
    'Date must be a UTC ISO 8601 string (e.g. 2026-01-01T00:00:00.000Z)'
  )
  .transform(s => new Date(s));

export const TelemetryQuerySchema = z
  .object({
    cursor: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    shipmentId: z.string().trim().optional(),
    from: utcDateString.optional(),
    to: utcDateString.optional(),
  })
  .refine(data => !(data.cursor && data.page), {
    message: 'Use either cursor or page for pagination, not both.',
  })
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

export const BulkTelemetryBodySchema = z.object({
  items: z.array(BulkTelemetryItemSchema).min(1).max(1000),
});

export type BulkTelemetryItem = z.infer<typeof BulkTelemetryItemSchema>;
export type BulkTelemetryBody = z.infer<typeof BulkTelemetryBodySchema>;

export const TelemetryThresholdsSchema = z.object({
  maxTemp: z.number(),
  maxHumidity: z.number(),
  minBatteryLevel: z.number(),
});

export type TelemetryThresholds = z.infer<typeof TelemetryThresholdsSchema>;
