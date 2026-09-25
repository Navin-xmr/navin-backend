import { z } from 'zod';

/**
 * Path parameter schema for public tracking by tracking number.
 */
export const PublicTrackingParamSchema = z.object({
  trackingNumber: z.string().min(1),
});

export type PublicTrackingParam = z.infer<typeof PublicTrackingParamSchema>;
