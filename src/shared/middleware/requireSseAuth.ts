import type { RequestHandler } from 'express';
import { AppError, ErrorCodes } from '../http/errors.js';
import { verifyToken } from '../../modules/auth/auth.service.js';
import { isTokenBlocked } from '../../infra/redis/tokenBlocklist.js';

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

function extractQueryToken(queryToken: unknown): string | null {
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken;
  }
  return null;
}

/**
 * Authenticates SSE connections via Authorization header or `?token=` query param.
 * EventSource in browsers often cannot send custom headers, so query-token auth is supported.
 */
export const requireSseAuth: RequestHandler = async (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization) ?? extractQueryToken(req.query.token);

  if (!token) {
    return next(
      new AppError(401, 'Missing or invalid authorization token', ErrorCodes.UNAUTHORIZED)
    );
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(new AppError(401, 'Invalid or expired token', ErrorCodes.UNAUTHORIZED));
  }

  if (payload.jti && (await isTokenBlocked(payload.jti))) {
    return next(new AppError(401, 'Token has been revoked', ErrorCodes.TOKEN_REVOKED));
  }

  req.user = payload;
  return next();
};
