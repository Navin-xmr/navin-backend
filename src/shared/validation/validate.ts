import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { AppError } from '../http/errors.js';

type ValidationSchemas = {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
};

export function validateRequest(input: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (input.body) req.body = input.body.parse(req.body);
      if (input.query) req.query = input.query.parse(req.query);
      if (input.params) req.params = input.params.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map(issue => ({
          path: issue.path.join('.') || 'root',
          message: issue.message,
          code: issue.code,
        }));
        next(
          new AppError(
            400,
            JSON.stringify({
              message: 'Validation error',
              details,
            }),
            'VALIDATION_ERROR'
          )
        );
        return;
      }

      next(new AppError(400, 'Validation error', 'VALIDATION_ERROR'));
    }
  };
}
