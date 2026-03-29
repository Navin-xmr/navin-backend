import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validate } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { SignupBodySchema, LoginBodySchema } from './auth.validation.js';
import { signupController, loginController } from './auth.controller.js';
import {
  createApiKeyController,
  listApiKeysController,
  revokeApiKeyController,
} from './apiKey.controller.js';

export const authRouter = Router();

authRouter.post('/signup', validate({ body: SignupBodySchema }), asyncHandler(signupController));
authRouter.post('/login', validate({ body: LoginBodySchema }), asyncHandler(loginController));

// API Key management routes (protected by JWT auth)
authRouter.post('/api-keys', asyncHandler(requireAuth), asyncHandler(createApiKeyController));
authRouter.get(
  '/api-keys/:organizationId',
  asyncHandler(requireAuth),
  asyncHandler(listApiKeysController)
);
authRouter.delete(
  '/api-keys/:apiKeyId',
  asyncHandler(requireAuth),
  asyncHandler(revokeApiKeyController)
);
