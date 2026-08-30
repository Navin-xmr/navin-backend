import type { RequestHandler } from 'express';
import {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  refreshToken,
  registerCompany,
  setup2fa,
  changePassword,
} from './auth.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Registers a new user account and returns a JWT.
 *
 * @param req.body.email - User email address.
 * @param req.body.name - Display name.
 * @param req.body.password - Plaintext password (min length enforced by validation).
 * @param req.body.organizationId - Optional organization to attach the user to.
 * @returns HTTP 201 with envelope `{ success, message, data }` where data is `{ user, token }`.
 * @throws {AppError} 409 EMAIL_TAKEN — when the email is already registered.
 */
export const signupController: RequestHandler = async (req, res) => {
  const ctx = {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
  const result = await signup(req.body, ctx);
  sendResponse(res, 201, true, 'Account created successfully', result);
};

/**
 * Authenticates credentials and returns a JWT.
 *
 * @param req.body.email - User email address.
 * @param req.body.password - Plaintext password.
 * @returns HTTP 200 with envelope `{ success, message, data }` where data is `{ user, token }`.
 * @throws {AppError} 401 INVALID_CREDENTIALS — when email or password is incorrect.
 */
export const loginController: RequestHandler = async (req, res) => {
  const ctx = {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
  const result = await login(req.body, ctx);
  sendResponse(res, 200, true, 'Login successful', result);
};

/**
 * Revokes the current JWT by adding its jti to the Redis blocklist.
 * Requires authentication (`requireAuth`).
 *
 * @returns HTTP 200 with envelope `{ success, message, data: null }`.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when the Authorization header/token is missing or invalid.
 * @throws {AppError} 401 TOKEN_REVOKED — when the token was already revoked.
 */
export const logoutController: RequestHandler = async (req, res) => {
  const token = req.headers.authorization!.substring(7);
  await logout(token);
  sendResponse(res, 200, true, 'Logged out successfully', null);
};

/**
 * Starts the password-reset flow. Always succeeds to prevent email enumeration.
 *
 * @param req.body.email - Email address that may receive a reset link.
 * @returns HTTP 200 with envelope `{ success, message, data: null }`.
 */
export const forgotPasswordController: RequestHandler = async (req, res) => {
  await forgotPassword(req.body.email as string);
  sendResponse(res, 200, true, 'If the email exists, a reset link has been sent', null);
};

/**
 * Completes password reset using a one-time reset token from email.
 *
 * @param req.body.token - Password-reset JWT from the email link.
 * @param req.body.newPassword - New plaintext password.
 * @returns HTTP 200 with envelope `{ success, message, data: null }`.
 * @throws {AppError} 400 ERR_AUTH_INVALID_RESET_TOKEN — when the token is invalid, expired, wrong type, or user missing.
 */
export const resetPasswordController: RequestHandler = async (req, res) => {
  await resetPassword(req.body.token as string, req.body.newPassword as string);
  sendResponse(res, 200, true, 'Password reset successfully', null);
};

/**
 * Issues a new JWT from a presented session token within the refresh grace window.
 *
 * @param req.body.token - Existing JWT to refresh (may be expired within grace period).
 * @returns HTTP 200 with envelope `{ success, message, data }` where data is `{ token, expiresIn }`.
 * @throws {AppError} 401 INVALID_TOKEN — when the token cannot be verified or lacks a jti.
 * @throws {AppError} 401 TOKEN_REVOKED — when the token was revoked.
 * @throws {AppError} 401 TOKEN_EXPIRED — when the token is too old to refresh.
 * @throws {AppError} 401 USER_NOT_FOUND — when the user no longer exists.
 */
export const refreshController: RequestHandler = async (req, res) => {
  const { token } = req.body as { token: string };
  const result = await refreshToken(token);
  sendResponse(res, 200, true, 'Token refreshed', result);
};

/**
 * Self-service company registration endpoint.
 * Creates both an Organization (type: ENTERPRISE) and its first admin user.
 *
 * @param req.body.companyName - Name of the company.
 * @param req.body.industry - Industry classification.
 * @param req.body.country - Country code.
 * @param req.body.companySize - Company size category.
 * @param req.body.adminName - Name of the first admin user.
 * @param req.body.email - Email for the admin user (must be unique).
 * @param req.body.password - Admin password (min 8 characters).
 * @returns HTTP 201 with envelope `{ success, message, data }` where data is `{ user, token }`.
 * @throws {AppError} 409 EMAIL_TAKEN — when the email is already registered.
 * @throws {AppError} 409 DUPLICATE_KEY — when the company name already exists.
 * @throws {AppError} 400 VALIDATION_ERROR — for missing/invalid fields.
 */
export const registerCompanyController: RequestHandler = async (req, res) => {
  const result = await registerCompany(req.body);
  sendResponse(res, 201, true, 'Company and admin user created successfully', result);
};

/**
 * Changes the authenticated user's password.
 * Verifies currentPassword, hashes newPassword, and blocklists the current JWT.
 *
 * @param req.body.currentPassword - The user's current plaintext password.
 * @param req.body.newPassword - The new password (min 8 chars).
 * @returns HTTP 200 with envelope `{ success, message, data: null }`.
 * @throws {AppError} 401 INVALID_CREDENTIALS — when currentPassword is wrong.
 */
export const changePasswordController: RequestHandler = async (req, res) => {
  const { userId } = req.user!;
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };
  const token = req.headers.authorization!.substring(7);
  await changePassword(userId, currentPassword, newPassword, token);
  sendResponse(res, 200, true, 'Password changed successfully', null);
};

/**
 * Generates a TOTP secret and returns a QR code data URL for authenticator-app setup.
 * Requires an authenticated JWT (`requireAuth`).
 *
 * Does NOT enable 2FA — that happens in the subsequent verify step.
 *
 * @returns HTTP 200 with envelope `{ success, message, data: { qrCodeUrl } }`.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when the JWT is missing, invalid, or revoked.
 */
export const setup2faController: RequestHandler = async (req, res) => {
  const { userId } = req.user!;
  const result = await setup2fa(userId);
  sendResponse(
    res,
    200,
    true,
    '2FA setup initiated. Scan the QR code with your authenticator app.',
    result
  );
};
