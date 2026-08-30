import type { RequestHandler } from 'express';
import { listSessions, revokeSession } from './session.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

/**
 * GET /api/auth/sessions
 *
 * Returns all active sessions for the authenticated user.
 *
 * @returns HTTP 200 with envelope `{ success, message, data: Session[] }`.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 */
export const listSessionsController: RequestHandler = async (req, res) => {
  const userId = req.user?.userId;

  if (!userId) {
    throw new AppError(401, 'Unauthorized', ErrorCodes.UNAUTHORIZED);
  }

  const sessions = await listSessions(userId);
  sendResponse(res, 200, true, 'Sessions retrieved', sessions);
};

/**
 * DELETE /api/auth/sessions/:jti
 *
 * Revokes a session by JTI — blocklists the token and removes the session record.
 * Cross-user revocation returns 403.
 *
 * @param req.params.jti - The JWT ID of the session to revoke.
 * @returns HTTP 200 with envelope `{ success, message, data: null }`.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when revoking another user's session.
 * @throws {AppError} 404 ERR_NOT_FOUND — when no session with that JTI exists.
 */
export const revokeSessionController: RequestHandler = async (req, res) => {
  const userId = req.user?.userId;

  if (!userId) {
    throw new AppError(401, 'Unauthorized', ErrorCodes.UNAUTHORIZED);
  }

  const { jti } = req.params;
  await revokeSession(userId, jti);
  sendResponse(res, 200, true, 'Session revoked successfully', null);
};
