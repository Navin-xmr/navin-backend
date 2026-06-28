// src/shared/http/errorMiddleware.ts
import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { AppError, ErrorCodes } from './errors.js';

export function errorMiddleware(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const isDev = process.env.NODE_ENV !== 'production';

    // Helper to keep the payload consistent
    const respond = (
      status: number,
      message: string,
      code: string,
      details?: Array<{ path: string; message: string; code: string }>
    ) => {
      return res.status(status).json({
        success: false,
        message,
        data: null,
        error: { code }, // Standardized envelope for frontend
        ...(details && { details }),
        ...(isDev && { stack: err.stack }),
      });
    };

    // Malformed JSON body
    if (
      err instanceof SyntaxError &&
      'status' in err &&
      (err as { status?: number }).status === 400
    ) {
      return respond(400, 'Invalid JSON payload', ErrorCodes.BAD_REQUEST);
    }

    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      return respond(413, 'Payload too large', ErrorCodes.BAD_REQUEST);
    }

    // Mongoose duplicate key error
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
      return respond(400, `Duplicate value for ${field}.`, ErrorCodes.DUPLICATE_KEY);
    }

    // Mongoose validation error
    if (err instanceof mongoose.Error.ValidationError) {
      const message = Object.values(err.errors)
        .map((e: mongoose.Error.ValidatorError | mongoose.Error.CastError) => e.message)
        .join(', ');
      return respond(422, message, ErrorCodes.VALIDATION_ERROR);
    }

    // App-level operational errors
    if (err instanceof AppError) {
      if (err.code === ErrorCodes.VALIDATION_ERROR) {
        try {
          const parsed = JSON.parse(err.message) as {
            message?: string;
            details?: Array<{ path: string; message: string; code: string }>;
          };
          return respond(
            err.statusCode,
            parsed.message ?? 'Validation error',
            err.code,
            parsed.details ?? []
          );
        } catch {
          return respond(err.statusCode, err.message, err.code);
        }
      }
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        data: null,
        error: { code: err.code },
        ...(err.details !== undefined && { details: err.details }),
        ...(isDev && { stack: err.stack }),
      });
    }

    // CORS origin rejection
    if (err instanceof Error && err.message === 'Not allowed by CORS') {
      return respond(403, 'CORS origin denied', ErrorCodes.FORBIDDEN);
    }

    // Fallback
    return respond(500, 'Internal Server Error', ErrorCodes.INTERNAL_ERROR);
  };
}
