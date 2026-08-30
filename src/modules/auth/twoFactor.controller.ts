import type { RequestHandler } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import { setup2fa, verify2fa, disable2fa, regenerateBackupCodes } from './twoFactor.service.js';

/**
 * POST /api/auth/2fa/setup
 *
 * Generates a fresh TOTP secret for the authenticated user and returns an
 * `otpauth://` URI that a client can encode as a QR code. 2FA is NOT yet
 * active until the user calls `POST /api/auth/2fa/verify`.
 *
 * @requires bearerAuth
 * @returns HTTP 200 `{ data: { otpauthUrl, secret } }`
 */
export const setup2faController: RequestHandler = async (req, res) => {
  const userId = req.user!.userId;
  const result = await setup2fa(userId);
  sendResponse(res, 200, true, '2FA setup initiated. Scan the QR code and verify.', result);
};

/**
 * POST /api/auth/2fa/verify
 *
 * Validates the first TOTP code after setup, enables 2FA on the account,
 * and returns 10 single-use backup codes (plaintext, shown exactly once).
 *
 * @requires bearerAuth
 * @param req.body.code - 6-digit TOTP code from the authenticator app.
 * @returns HTTP 200 `{ data: { backupCodes: string[] } }`
 * @throws {AppError} 400 TOTP_NOT_SETUP — setup not initiated.
 * @throws {AppError} 400 TOTP_INVALID_CODE — wrong or expired code.
 * @throws {AppError} 409 TOTP_ALREADY_ENABLED — 2FA already active.
 */
export const verify2faController: RequestHandler = async (req, res) => {
  const userId = req.user!.userId;
  const { code } = req.body as { code: string };
  const result = await verify2fa(userId, code);
  sendResponse(res, 200, true, '2FA enabled successfully. Store backup codes safely.', result);
};

/**
 * DELETE /api/auth/2fa
 *
 * Disables 2FA on the account after verifying the user's current password.
 * Clears the TOTP secret and all backup codes.
 *
 * @requires bearerAuth
 * @param req.body.password - Current account password.
 * @returns HTTP 200 `{ data: null }`
 * @throws {AppError} 400 TOTP_NOT_ENABLED — 2FA is not active.
 * @throws {AppError} 401 UNAUTHORIZED — incorrect password.
 */
export const disable2faController: RequestHandler = async (req, res) => {
  const userId = req.user!.userId;
  const { password } = req.body as { password: string };
  await disable2fa(userId, password);
  sendResponse(res, 200, true, '2FA disabled successfully', null);
};

/**
 * POST /api/auth/2fa/backup-codes/regenerate
 *
 * Invalidates all existing backup codes and issues 10 new ones.
 * Requires 2FA to be enabled.
 *
 * @requires bearerAuth
 * @returns HTTP 200 `{ data: { backupCodes: string[] } }`
 * @throws {AppError} 400 TOTP_NOT_ENABLED — 2FA is not active.
 */
export const regenerateBackupCodesController: RequestHandler = async (req, res) => {
  const userId = req.user!.userId;
  const result = await regenerateBackupCodes(userId);
  sendResponse(res, 200, true, 'Backup codes regenerated. Store them safely.', result);
};
