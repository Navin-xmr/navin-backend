import { describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { buildHelmetMiddleware } from '../helmet.js';

describe('Helmet configuration', () => {
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
  });

  it('applies relaxed CSP directives in development', async () => {
    process.env.NODE_ENV = 'development';
    const app = express();
    app.use(buildHelmetMiddleware());
    app.get('/health', (_req, res) => res.status(200).send('ok'));

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("'unsafe-inline'");
  });

  it('applies strict CSP directives in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = express();
    app.use(buildHelmetMiddleware());
    app.get('/health', (_req, res) => res.status(200).send('ok'));

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).not.toContain("'unsafe-eval'");
  });

  it('does not strip weak ETag support from downstream handlers', async () => {
    process.env.NODE_ENV = 'development';
    const app = express();
    app.use(buildHelmetMiddleware());
    app.set('etag', 'weak');
    app.get('/health', (_req, res) => res.status(200).send('ok'));

    const first = await request(app).get('/health');
    const etag = first.headers.etag;
    expect(etag).toBeDefined();

    const second = await request(app)
      .get('/health')
      .set('If-None-Match', etag as string);
    expect(second.status).toBe(304);
  });
});
