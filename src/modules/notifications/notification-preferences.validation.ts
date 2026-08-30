import { z } from 'zod';

export const UpdateNotificationPreferenceBodySchema = z.object({
  event: z.enum([
    'shipment_created',
    'status_changed',
    'delivery_confirmed',
    'payment_received',
    'dispute_opened',
    'dispute_resolved',
  ]),
  channel: z.enum(['email', 'sms']),
  enabled: z.boolean(),
});

export type UpdateNotificationPreferenceInput = z.infer<
  typeof UpdateNotificationPreferenceBodySchema
>;
