import { z } from 'zod';

const normalizedTelemetrySchema = z
  .object({
    sensorId: z.string().min(1).optional(),
    shipmentId: z.string().min(1),
    temperature: z.coerce.number().min(-50).max(100),
    humidity: z.coerce.number(),
    latitude: z.coerce.number(),
    longitude: z.coerce.number(),
    batteryLevel: z.coerce.number().min(0).max(100).optional(),
    timestamp: z.coerce.date(),
  })
  .strict();

const sensorTelemetrySchema = z
  .object({
    sensorId: z.string().min(1),
    temp: z.coerce.number().min(-50).max(100),
    humidity: z.coerce.number(),
    location: z
      .object({
        lat: z.coerce.number(),
        lng: z.coerce.number(),
      })
      .strict(),
    batteryLevel: z.coerce.number().min(0).max(100).optional(),
    timestamp: z.coerce.date(),
  })
  .strict();

export const IotWebhookBodySchema = z.union([normalizedTelemetrySchema, sensorTelemetrySchema]);

export type IotWebhookBody = z.infer<typeof IotWebhookBodySchema>;
