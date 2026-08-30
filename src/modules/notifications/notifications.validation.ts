import { z } from 'zod';

export const GetNotificationsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  type: z.enum(['shipments', 'settlements', 'system']).optional(),
  q: z.string().trim().optional(),
});

export const NotificationIdParamSchema = z.object({
  id: z.string().min(1),
});

export type GetNotificationsQuery = z.infer<typeof GetNotificationsQuerySchema>;
export type NotificationIdParam = z.infer<typeof NotificationIdParamSchema>;
