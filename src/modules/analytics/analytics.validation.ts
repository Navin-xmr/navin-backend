import { z } from 'zod';

export const PerformanceQuerySchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine(({ startDate, endDate }) => startDate <= endDate, {
    message: 'startDate must be <= endDate',
  });

export type PerformanceQuery = z.infer<typeof PerformanceQuerySchema>;
