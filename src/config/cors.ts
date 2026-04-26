import cors, { type CorsOptionsDelegate } from 'cors';
import type { Request } from 'express';

function isAllowedOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes(origin);
}

function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? '';
  return raw
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

const corsOptionsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
  const requestOrigin = req.header('Origin');
  const allowedOrigins = getAllowedOrigins();

  // Allow non-browser requests that do not send an Origin header.
  if (!requestOrigin) {
    return callback(null, { origin: true });
  }

  if (allowedOrigins.length === 0 || isAllowedOrigin(requestOrigin, allowedOrigins)) {
    return callback(null, { origin: true });
  }

  return callback(new Error('Not allowed by CORS'));
};

export const corsMiddleware = cors(corsOptionsDelegate);
export const corsPreflight = cors(corsOptionsDelegate);
