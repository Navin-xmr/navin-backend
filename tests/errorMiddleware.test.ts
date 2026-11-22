// tests/errorMiddleware.test.ts

import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { errorMiddleware } from '../src/shared/http/errorMiddleware.js';
import { AppError, ErrorCodes } from '../src/shared/http/errors.js';
import { CHAIN_ERROR_MAP } from '../src/shared/types/chain.js';

function buildTestApp(err: unknown) {
  const app = express();
  app.get('/test', (_req: Request, _res: Response, next: NextFunction) => next(err));
  app.use(errorMiddleware());
  return app;
}

describe('errorMiddleware', () => {
  describe('AppError', () => {
    it('returns the AppError status code, message, and standardized code', async () => {
      // Fix: Added the 3rd argument 'ERR_NOT_FOUND'
      const app = buildTestApp(new AppError(404, 'Not found', ErrorCodes.NOT_FOUND));
      const res = await request(app).get('/test');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Not found');
      // Acceptance Criteria #93: Verify the standardized code envelope
      expect(res.body.error.code).toBe('ERR_NOT_FOUND');
    });
  });

  describe('chain errors (ERR_CHAIN_*)', () => {
    it('maps every ERR_CHAIN_* code through the middleware with safe details', async () => {
      await Promise.all(
        Object.entries(CHAIN_ERROR_MAP).map(async ([name, { code, status }]) => {
          const app = buildTestApp(
            new AppError(status, 'Chain contract error: ' + name, code, { contractCode: 3 })
          );
          const res = await request(app).get('/test');

          expect(res.status).toBe(status);
          expect(res.body.success).toBe(false);
          expect(res.body.message).toBe('Chain contract error: ' + name);
          expect(res.body.error.code).toBe(code);
          expect(code).toMatch(/^ERR_CHAIN_/);
          expect(res.body.details).toEqual({ contractCode: 3 });
          expect(typeof res.body.details.contractCode).toBe('number');
        })
      );
    });

    it('covers every mapped ERR_CHAIN_* code (table test)', () => {
      const registered = new Set(Object.values(ErrorCodes));
      for (const entry of Object.entries(CHAIN_ERROR_MAP)) {
        const name = entry[0];
        const { code, status } = entry[1];
        expect(code).toMatch(/^ERR_CHAIN_/);
        expect(registered.has(code)).toBe(true);
        expect([400, 403, 404, 409, 422, 429, 502, 503].includes(status)).toBe(true);
        const err = new AppError(status, 'Chain contract error: ' + name, code, {
          contractCode: 1,
        });
        expect(err.statusCode).toBe(status);
        expect(err.code).toBe(code);
      }
    });
  });

  describe('Mongoose duplicate key error (11000)', () => {
    it('maps to 400 and reports the duplicate field with ERR_DUPLICATE_KEY', async () => {
      const dupErr = Object.assign(new Error('E11000 duplicate'), {
        code: 11000,
        keyValue: { email: 'test@test.com' },
      });
      const app = buildTestApp(dupErr);
      const res = await request(app).get('/test');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('email');
      expect(res.body.error.code).toBe('ERR_DUPLICATE_KEY');
    });
  });

  describe('Mongoose ValidationError', () => {
    it('maps to 422 and includes field messages with ERR_VALIDATION_FAILED', async () => {
      const validationErr = new mongoose.Error.ValidationError();
      validationErr.errors['name'] = new mongoose.Error.ValidatorError({
        message: 'name is required',
        path: 'name',
        type: 'required',
        value: undefined,
      });
      const app = buildTestApp(validationErr);
      const res = await request(app).get('/test');

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('name is required');
      expect(res.body.error.code).toBe('ERR_VALIDATION_FAILED');
    });
  });

  describe('unknown error', () => {
    it('falls back to 500 Internal Server Error with ERR_INTERNAL_SERVER_ERROR', async () => {
      const app = buildTestApp(new Error('boom'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Internal Server Error');
      expect(res.body.error.code).toBe('ERR_INTERNAL_SERVER_ERROR');
    });
  });

  describe('stack trace exposure', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('includes stack in non-production mode', async () => {
      process.env.NODE_ENV = 'development';
      // Fix: Added 3rd argument
      const app = buildTestApp(new AppError(400, 'bad', ErrorCodes.BAD_REQUEST));
      const res = await request(app).get('/test');
      expect(res.body.stack).toBeDefined();
    });

    it('omits stack in production mode', async () => {
      process.env.NODE_ENV = 'production';
      // Fix: Added 3rd argument
      const app = buildTestApp(new AppError(400, 'bad', ErrorCodes.BAD_REQUEST));
      const res = await request(app).get('/test');
      expect(res.body.stack).toBeUndefined();
    });
  });
});
