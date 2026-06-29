import { z } from 'zod';

const utcDateString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/,
    'Date must be a UTC ISO 8601 string (e.g. 2026-01-01T00:00:00.000Z)'
  )
  .transform(s => new Date(s));

export const PerformanceQuerySchema = z
  .object({
    startDate: utcDateString,
    endDate: utcDateString,
    granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
  })
  .refine(({ startDate, endDate }) => startDate <= endDate, {
    message: 'startDate must be <= endDate',
  });

export type PerformanceQuery = z.infer<typeof PerformanceQuerySchema>;
