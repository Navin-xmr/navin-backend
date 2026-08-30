import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/roles.js';
import {
  SignupBodySchema,
  LoginBodySchema,
  ForgotPasswordBodySchema,
  ResetPasswordBodySchema,
  RefreshBodySchema,
  RegisterCompanyBodySchema,
  Verify2faBodySchema,
  Disable2faBodySchema,
  ChangePasswordBodySchema,
} from './auth.validation.js';
import {
  signupController,
  loginController,
  logoutController,
  forgotPasswordController,
  resetPasswordController,
  refreshController,
  registerCompanyController,
  changePasswordController,
} from './auth.controller.js';
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
import {
  setup2faController,
  verify2faController,
  disable2faController,
  regenerateBackupCodesController,
} from './twoFactor.controller.js';
import { listSessionsController, revokeSessionController } from './session.controller.js';
import { SessionJtiParamSchema } from './session.validation.js';

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
authRouter.post(
  '/register/company',
  validateRequest({ body: RegisterCompanyBodySchema }),
  asyncHandler(registerCompanyController)
);
authRouter.post('/logout', asyncHandler(requireAuth), asyncHandler(logoutController));
authRouter.patch(
  '/password',
  asyncHandler(requireAuth),
  validateRequest({ body: ChangePasswordBodySchema }),
  asyncHandler(changePasswordController)
);
authRouter.post(
  '/refresh',
  validateRequest({ body: RefreshBodySchema }),
  asyncHandler(refreshController)
);

// PUBLIC: password-reset-flow
authRouter.post(
  '/forgot-password',
  validateRequest({ body: ForgotPasswordBodySchema }),
  asyncHandler(forgotPasswordController)
);
// PUBLIC: password-reset-flow
authRouter.post(
  '/reset-password',
  validateRequest({ body: ResetPasswordBodySchema }),
  asyncHandler(resetPasswordController)
);

// 2FA setup (protected by JWT auth)
authRouter.post('/2fa/setup', asyncHandler(requireAuth), asyncHandler(setup2faController));

// ── API Key management (DEPRECATED — use /api/company/api-keys) ────────────────
// These routes are kept as aliases for backward compatibility.
// New implementations should use the company-scoped routes at /api/company/api-keys
// which derive organizationId from JWT and follow the v2 response shape.
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

// ── TOTP 2FA routes (all require JWT auth) ────────────────────────────────────

// Initiate 2FA setup: generates TOTP secret + otpauth URI
authRouter.post('/2fa/setup', asyncHandler(requireAuth), asyncHandler(setup2faController));

// Verify first TOTP code, enable 2FA, return backup codes (rate-limited in app.ts)
authRouter.post(
  '/2fa/verify',
  asyncHandler(requireAuth),
  validateRequest({ body: Verify2faBodySchema }),
  asyncHandler(verify2faController)
);

// Disable 2FA — requires current password confirmation
authRouter.delete(
  '/2fa',
  asyncHandler(requireAuth),
  validateRequest({ body: Disable2faBodySchema }),
  asyncHandler(disable2faController)
);

// Regenerate backup codes — invalidates old ones
authRouter.post(
  '/2fa/backup-codes/regenerate',
  asyncHandler(requireAuth),
  asyncHandler(regenerateBackupCodesController)
);
// Session management routes (protected by JWT auth)
authRouter.get('/sessions', asyncHandler(requireAuth), asyncHandler(listSessionsController));
authRouter.delete(
  '/sessions/:jti',
  asyncHandler(requireAuth),
  validateRequest({ params: SessionJtiParamSchema }),
  asyncHandler(revokeSessionController)
);
