import type { RequestHandler } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppError } from '../http/errors.js';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export const verifyStellarSignature: RequestHandler = (req, _res, next) => {
  const secret = process.env.STELLAR_WEBHOOK_SECRET;

  if (!secret) {
    throw new AppError(500, 'Stellar webhook secret not configured', 'CONFIGURATION_ERROR');
  }

  const signature = req.headers['x-stellar-signature'] as string | undefined;

  if (!signature) {
    throw new AppError(401, 'Missing X-Stellar-Signature header', 'UNAUTHORIZED');
  }

  const rawBody = req.rawBody;

  if (!rawBody) {
    throw new AppError(400, 'Missing request body', 'BAD_REQUEST');
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  let sigBuffer: Buffer;
  let expectedBuffer: Buffer;

  try {
    sigBuffer = Buffer.from(signature, 'hex');
    expectedBuffer = Buffer.from(expected, 'hex');
  } catch {
    throw new AppError(401, 'Invalid signature format', 'UNAUTHORIZED');
  }

  // SECURITY: [Timing Attack] — This prevents timing-based signature recovery (side-channel attacks) by using crypto.timingSafeEqual instead of standard equality (===), ensuring comparison time is constant regardless of how many bytes match.
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new AppError(401, 'Invalid webhook signature', 'UNAUTHORIZED');
  }

  next();
};
