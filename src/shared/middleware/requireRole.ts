import type { RequestHandler } from 'express';
import { AppError } from '../http/errors.js';

/**
 * Middleware to require a user to have one of the specified roles.
 * Usage: requireRole('Admin', 'Manager')
 */
export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'Forbidden: insufficient role', 'FORBIDDEN'));
    }
    next();
  };
}
