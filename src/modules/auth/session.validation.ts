import { z } from 'zod';

/**
 * Path params schema for `DELETE /api/auth/sessions/:jti`.
 * We accept any non-empty string and let the service layer throw 404 for unknown JTIs.
 */
export const SessionJtiParamSchema = z.object({
  jti: z.string().min(1, 'jti is required'),
});

export type SessionJtiParam = z.infer<typeof SessionJtiParamSchema>;
