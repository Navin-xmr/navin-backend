import type { RequestHandler } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppError, ErrorCodes } from '../http/errors.js';
import { env } from '../../env.js';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

/**
 * Verifies the HMAC-SHA256 signature of an incoming Stellar webhook.
 *
 * Expects `x-stellar-signature` (hex) over the raw request body, using
 * `STELLAR_WEBHOOK_SECRET`. Rejects missing/invalid signatures with 401.
 *
 * @throws {AppError} 500 when STELLAR_WEBHOOK_SECRET is not configured.
 * @throws {AppError} 401 when the signature header is missing or invalid.
 * @throws {AppError} 400 when the raw request body is unavailable.
 */
export const verifyStellarSignature: RequestHandler = (req, _res, next) => {
  const secret = env.STELLAR_WEBHOOK_SECRET;

  if (!secret) {
    throw new AppError(500, 'Stellar webhook secret not configured', ErrorCodes.STELLAR_CONFIG);
  }

  const signature = req.headers['x-stellar-signature'] as string | undefined;

  if (!signature) {
    throw new AppError(401, 'Missing X-Stellar-Signature header', ErrorCodes.UNAUTHORIZED);
  }

  const rawBody = req.rawBody;

  if (!rawBody) {
    throw new AppError(400, 'Missing request body', ErrorCodes.BAD_REQUEST);
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  let sigBuffer: Buffer;
  let expectedBuffer: Buffer;

  try {
    sigBuffer = Buffer.from(signature, 'hex');
    expectedBuffer = Buffer.from(expected, 'hex');
  } catch {
    throw new AppError(401, 'Invalid signature format', ErrorCodes.UNAUTHORIZED);
  }

  // SECURITY: [Timing Attack] — constant-time compare to prevent side-channel recovery.
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new AppError(401, 'Invalid webhook signature', ErrorCodes.UNAUTHORIZED);
  }

  next();
};
