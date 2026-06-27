import { z } from 'zod';

export const AuditLogsQuerySchema = z
  .object({
    cursor: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    userId: z.string().trim().optional(),
    action: z.string().trim().optional(),
    resource: z.string().trim().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'from must be before or equal to to',
      });
    }
  });

export type AuditLogsQuery = z.infer<typeof AuditLogsQuerySchema>;
