// src/shared/middleware/requireAuth.ts
import type { RequestHandler } from 'express';
import { AppError, ErrorCodes } from '../http/errors.js';
import { verifyToken, type TokenPayload } from '../../modules/auth/auth.service.js';
import { isTokenBlocked } from '../../infra/redis/tokenBlocklist.js';

// We explicitly use 'declare module' or 'namespace' to extend Express
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // SECURITY: [Credential Spoofing / Format Confusion] — This prevents unauthorized access by enforcing the strict OAuth 2.0 'Bearer ' token format, rejecting poorly formatted or non-standard authorization headers.
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError(401, 'Missing or invalid authorization header', ErrorCodes.UNAUTHORIZED)
    );
  }

  const token = authHeader.substring(7);

  let payload: TokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(new AppError(401, 'Invalid or expired token', ErrorCodes.UNAUTHORIZED));
  }

  // SECURITY: [Token Replay / Compromised Token] — This prevents the reuse of revoked or logged-out tokens by checking the unique JWT ID (JTI) against a Redis-backed blocklist, enabling immediate session invalidation before token natural expiry.
  if (payload.jti && (await isTokenBlocked(payload.jti))) {
    return next(new AppError(401, 'Token has been revoked', 'TOKEN_REVOKED'));
  }

  req.user = payload;
  return next();
};
