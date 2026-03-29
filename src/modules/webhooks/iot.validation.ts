import { z } from 'zod';

export const IotWebhookBodySchema = z
  .object({
    shipmentId: z.string().min(1),

    temperature: z.coerce.number(),
    humidity: z.coerce.number(),
    latitude: z.coerce.number(),
    longitude: z.coerce.number(),
    batteryLevel: z.coerce.number(),

    // Accept ISO strings or numeric timestamps.
    timestamp: z.coerce.date(),
  })
  .strict();

export type IotWebhookBody = z.infer<typeof IotWebhookBodySchema>;
