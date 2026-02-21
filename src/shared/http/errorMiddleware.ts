import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { AppError } from './errors.js';

export function errorMiddleware(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const isDev = process.env.NODE_ENV !== 'production';

    // Mongoose duplicate key error
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
      return res.status(400).json({
        success: false,
        message: `Duplicate value for ${field}.`,
        ...(isDev && { stack: err.stack }),
      });
    }

    // Mongoose validation error
    if (err instanceof mongoose.Error.ValidationError) {
      const message = Object.values(err.errors)
        .map((e: mongoose.Error.ValidatorError | mongoose.Error.CastError) => e.message)
        .join(', ');
      return res.status(422).json({
        success: false,
        message,
        ...(isDev && { stack: err.stack }),
      });
    }

    // App-level operational errors
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        ...(isDev && { stack: err.stack }),
      });
    }

    // Fallback
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      ...(isDev && { stack: err.stack }),
    });
  };
}
