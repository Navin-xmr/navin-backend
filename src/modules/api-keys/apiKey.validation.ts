import { z } from 'zod';

/**
 * Schema for creating an API key under /api/company/api-keys.
 * organizationId is NOT accepted in the body — it's derived from req.user.organizationId.
 */
export const CreateApiKeyBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  shipmentId: z.string().trim().optional(),
});

export const ApiKeyIdParamSchema = z.object({
  apiKeyId: z.string().trim().min(1, 'apiKeyId is required'),
});
