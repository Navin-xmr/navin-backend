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

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError(401, 'Missing or invalid authorization header', ErrorCodes.UNAUTHORIZED)
    );
  }

  const token = authHeader.substring(7);

  let payload: TokenPayload;
  try {
    const payload = verifyToken(token);
    // TypeScript should now recognize .user thanks to the declare global block
    req.user = payload;
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired token', ErrorCodes.UNAUTHORIZED));
  }

  if (await isTokenBlocked(payload.jti)) {
    throw new AppError(401, 'Token has been revoked', 'TOKEN_REVOKED');
  }

  req.user = payload;
  next();
};
