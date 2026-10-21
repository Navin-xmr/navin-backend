import { z } from 'zod';

/**
 * Path parameter schema for public tracking by tracking number.
 * Trimmed alphanumeric / hyphen / underscore tokens only — rejects empty,
 * whitespace-only, and unsafe path segments with a 400 VALIDATION_ERROR.
 */
export const PublicTrackingParamSchema = z.object({
  trackingNumber: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid tracking number format'),
});

export type PublicTrackingParam = z.infer<typeof PublicTrackingParamSchema>;
