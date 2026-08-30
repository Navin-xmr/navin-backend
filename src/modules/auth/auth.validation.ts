import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE } from '../../shared/constants/index.js';

/**
 * Body schema for `POST /api/auth/signup`.
 *
 * Business domain: register a new user account. Password minimum length is shared
 * via PASSWORD_MIN_LENGTH so auth and invitation accept flows stay policy-aligned.
 * Optional organizationId attaches the user to an existing org when invited/provisioned.
 *
 * SECURITY: [CWE-284: Improper Access Control] — This schema intentionally does NOT include
 * a `role` field. Public signup is restricted to VIEWER/CUSTOMER roles only.
 * Privileged roles (SUPER_ADMIN, ADMIN, MANAGER) are exclusively assignable by:
 * - POST /api/users (ADMIN only, creates password-less users)
 * - POST /api/users/team (ADMIN only, creates password-less team members)
 * - Invitation flow via email verification
 * This prevents unauthenticated privilege escalation attacks where users could
 * self-assign admin roles during registration.
 */
export const SignupBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE),
  organizationId: z.string().min(1).optional(),
});

/**
 * Body schema for `POST /api/auth/login`.
 *
 * Business domain: exchange credentials for a JWT bearer token used by subsequent
 * authenticated API calls (Authorization: Bearer).
 */
export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

/**
 * Body schema for `POST /api/auth/forgot-password`.
 *
 * Business domain: start password reset. Only email is required so the endpoint
 * cannot be used to probe password strength; the service always returns a generic success.
 */
export const ForgotPasswordBodySchema = z.object({
  email: z.string().email(),
});

/**
 * Body schema for `POST /api/auth/reset-password`.
 *
 * Business domain: complete password reset with a one-time token from email.
 * newPassword reuses the global minimum length policy to prevent weak resets.
 */
export const ResetPasswordBodySchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE),
});

/**
 * Body schema for `POST /api/auth/refresh`.
 *
 * Business domain: mint a new access token from a presented refresh/session token
 * without re-collecting credentials (token must be non-empty).
 */
export const RefreshBodySchema = z.object({
  token: z.string().min(1),
});

/**
 * Body schema for `POST /api/auth/register/company`.
 *
 * Business domain: self-service company registration creating both an Organization
 * (type: ENTERPRISE) and its first admin user in a single call.
 */
export const RegisterCompanyBodySchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  industry: z.string().min(1, 'Industry is required'),
  country: z.string().min(1, 'Country is required'),
  companySize: z.string().min(1, 'Company size is required'),
  adminName: z.string().min(1, 'Admin name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE),
});

export type SignupInput = z.infer<typeof SignupBodySchema>;
export type LoginInput = z.infer<typeof LoginBodySchema>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordBodySchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordBodySchema>;
export type RefreshInput = z.infer<typeof RefreshBodySchema>;
export type RegisterCompanyInput = z.infer<typeof RegisterCompanyBodySchema>;

// ── 2FA / TOTP schemas ────────────────────────────────────────────────────────

/**
 * Body schema for `POST /api/auth/2fa/verify`.
 * The 6-digit TOTP code from the authenticator app.
 */
export const Verify2faBodySchema = z.object({
  code: z
    .string()
    .length(6, 'TOTP code must be exactly 6 digits')
    .regex(/^\d{6}$/, 'TOTP code must contain only digits'),
});

/**
 * Body schema for `DELETE /api/auth/2fa`.
 * Current password required to confirm ownership before disabling 2FA.
 */
export const Disable2faBodySchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export type Verify2faInput = z.infer<typeof Verify2faBodySchema>;
export type Disable2faInput = z.infer<typeof Disable2faBodySchema>;

/**
 * Body schema for `PATCH /api/auth/password`.
 */
export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE),
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordBodySchema>;
