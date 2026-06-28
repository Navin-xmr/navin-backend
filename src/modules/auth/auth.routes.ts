import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/roles.js';
import { SignupBodySchema, LoginBodySchema, RefreshBodySchema } from './auth.validation.js';
import { signupController, loginController, logoutController, refreshController } from './auth.controller.js';
import {
  createApiKeyController,
  listApiKeysController,
  revokeApiKeyController,
} from './apiKey.controller.js';
import {
  ApiKeyIdParamSchema,
  CreateApiKeyBodySchema,
  OrganizationIdParamSchema,
} from './apiKey.validation.js';

export const authRouter = Router();

authRouter.post(
  '/signup',
  validateRequest({ body: SignupBodySchema }),
  asyncHandler(signupController)
);
authRouter.post(
  '/login',
  validateRequest({ body: LoginBodySchema }),
  asyncHandler(loginController)
);
authRouter.post('/logout', asyncHandler(requireAuth), asyncHandler(logoutController));
authRouter.post(
  '/refresh',
  validateRequest({ body: RefreshBodySchema }),
  asyncHandler(refreshController)
);

// API Key management routes (protected by JWT auth + admin role)
authRouter.post(
  '/api-keys',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ body: CreateApiKeyBodySchema }),
  asyncHandler(createApiKeyController)
);
authRouter.get(
  '/api-keys/:organizationId',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: OrganizationIdParamSchema }),
  asyncHandler(listApiKeysController)
);
authRouter.delete(
  '/api-keys/:apiKeyId',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: ApiKeyIdParamSchema }),
  asyncHandler(revokeApiKeyController)
);
