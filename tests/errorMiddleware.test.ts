import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { errorMiddleware } from '../src/shared/http/errorMiddleware.js';
import { AppError } from '../src/shared/http/errors.js';

function buildTestApp(err: unknown) {
  const app = express();
  app.get('/test', (_req: Request, _res: Response, next: NextFunction) => next(err));
  app.use(errorMiddleware());
  return app;
}

describe('errorMiddleware', () => {
  describe('AppError', () => {
    it('returns the AppError status code and message', async () => {
      const app = buildTestApp(new AppError(404, 'Not found'));
      const res = await request(app).get('/test');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Not found');
    });
  });

  describe('Mongoose duplicate key error (11000)', () => {
    it('maps to 400 and reports the duplicate field', async () => {
      const dupErr = Object.assign(new Error('E11000 duplicate'), {
        code: 11000,
        keyValue: { email: 'test@test.com' },
      });
      const app = buildTestApp(dupErr);
      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('email');
    });
  });

  describe('Mongoose ValidationError', () => {
    it('maps to 422 and includes field messages', async () => {
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
    });
  });

  describe('unknown error', () => {
    it('falls back to 500 Internal Server Error', async () => {
      const app = buildTestApp(new Error('boom'));
      const res = await request(app).get('/test');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Internal Server Error');
    });
  });

  describe('stack trace exposure', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('includes stack in non-production mode', async () => {
      process.env.NODE_ENV = 'development';
      const app = buildTestApp(new AppError(400, 'bad'));
      const res = await request(app).get('/test');
      expect(res.body.stack).toBeDefined();
    });

    it('omits stack in production mode', async () => {
      process.env.NODE_ENV = 'production';
      const app = buildTestApp(new AppError(400, 'bad'));
      const res = await request(app).get('/test');
      expect(res.body.stack).toBeUndefined();
    });
  });
});
