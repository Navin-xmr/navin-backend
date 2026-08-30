import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/roles.js';
import { CreateApiKeyBodySchema, ApiKeyIdParamSchema } from './apiKey.validation.js';
import {
  createApiKeyController,
  listApiKeysController,
  revokeApiKeyController,
} from './apiKey.controller.js';

export const apiKeysRouter = Router();

/**
 * POST /api/company/api-keys
 *
 * Creates an API key for the caller's organization.
 * organizationId is derived from the JWT — do NOT include it in the request body.
 *
 * Response: 201 { data: { key: ApiKeyMetadata, secret: string } }
 * The `secret` is shown exactly once.
 */
apiKeysRouter.post(
  '/',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ body: CreateApiKeyBodySchema }),
  asyncHandler(createApiKeyController)
);

/**
 * GET /api/company/api-keys
 *
 * Lists all active API keys for the caller's organization.
 * Scoped automatically via req.user.organizationId.
 *
 * Response: 200 { data: ApiKeyRecord[] }
 */
apiKeysRouter.get(
  '/',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(listApiKeysController)
);

/**
 * DELETE /api/company/api-keys/:apiKeyId
 *
 * Soft-revokes an API key (sets isActive = false).
 * Only keys belonging to the caller's organization can be revoked.
 *
 * Response: 200 { data: null }
 */
apiKeysRouter.delete(
  '/:apiKeyId',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: ApiKeyIdParamSchema }),
  asyncHandler(revokeApiKeyController)
);

export default apiKeysRouter;
