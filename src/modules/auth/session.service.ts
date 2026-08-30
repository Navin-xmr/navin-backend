import { SessionModel } from './session.model.js';
import { blockToken } from '../../infra/redis/tokenBlocklist.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — matches auth.service TOKEN_TTL_SECONDS

export interface CreateSessionParams {
  userId: string;
  jti: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Persists a new session record after a successful login or signup.
 * Errors are silently swallowed so that a session-store failure never blocks
 * the auth response.
 */
export async function createSession(params: CreateSessionParams): Promise<void> {
  try {
    await SessionModel.create({
      userId: params.userId,
      jti: params.jti,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  } catch (err) {
    // Non-fatal: session tracking is a side-effect. Log in production but
    // never let a DB write failure prevent the user from receiving their token.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[session] Failed to persist session record:', message);
  }
}

/**
 * Returns all active session records for a given user, ordered newest first.
 */
export async function listSessions(userId: string) {
  return SessionModel.find({ userId }).sort({ createdAt: -1 }).select('-__v').lean();
}

/**
 * Revokes a session by JTI: blocklists the token in Redis and deletes the session record.
 * Only the owner of the session may revoke it (cross-user → 403).
 *
 * @param requestingUserId - The authenticated user requesting the revocation.
 * @param jti              - The JTI of the session to revoke.
 * @throws {AppError} 404 when no session with that JTI exists.
 * @throws {AppError} 403 when the session belongs to a different user.
 */
export async function revokeSession(requestingUserId: string, jti: string): Promise<void> {
  const session = await SessionModel.findOne({ jti });

  if (!session) {
    throw new AppError(404, 'Session not found', ErrorCodes.NOT_FOUND);
  }

  if (session.userId.toString() !== requestingUserId) {
    throw new AppError(403, "Cannot revoke another user's session", ErrorCodes.FORBIDDEN);
  }

  // Blocklist the token in Redis so requireAuth rejects it immediately.
  await blockToken(jti, TOKEN_TTL_SECONDS);

  await SessionModel.deleteOne({ jti });
}
