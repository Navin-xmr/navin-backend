import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { sendResponse } from '../http/sendResponse.js';

const isDev = process.env.NODE_ENV !== 'production';

export const standardLimiter = rateLimit({
  windowMs: isDev ? 60 * 1000 : 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req: Request, res: Response) => {
    const rateLimitState = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
    const retryAfter = rateLimitState?.resetTime
      ? Math.max(1, Math.ceil((rateLimitState.resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(15 * 60);

    res.setHeader('Retry-After', String(retryAfter));

    sendResponse(
      res,
      429,
      false,
      'Too many login attempts, please try again later.',
      null,
      undefined,
      { retryAfter }
    );
  },
});
