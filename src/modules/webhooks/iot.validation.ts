import { z } from 'zod';

export const IotWebhookBodySchema = z.object({
  sensorId: z.string().min(1),

  // Accept ISO strings or numeric timestamps.
  timestamp: z.coerce.date(),

  temp: z.coerce.number(),
  humidity: z.coerce.number(),

  location: z.object({
    lat: z.coerce.number(),
    lng: z.coerce.number(),
  }),
}).strict();

export type IotWebhookBody = z.infer<typeof IotWebhookBodySchema>;
