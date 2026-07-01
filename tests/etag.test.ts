import request from 'supertest';
import express from 'express';
import { afterEach, jest } from '@jest/globals';
import { healthRouter } from '../src/modules/health/health.routes.js';

const buildHealthApp = () => {
  const app = express();
  app.set('etag', 'weak');
  app.use('/api/health', healthRouter);
  return app;
};

describe('ETag support (Issue #80)', () => {
  const app = buildHealthApp();

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('first request returns 200 with an ETag header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['etag']).toBeDefined();
  });

  it('subsequent request with matching If-None-Match returns 304 Not Modified', async () => {
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(fixedTime);
    jest.spyOn(process, 'uptime').mockReturnValue(123.456);

    const first = await request(app).get('/api/health');
    const etag = first.headers['etag'] as string;

    const second = await request(app).get('/api/health').set('If-None-Match', etag);
    expect(second.status).toBe(304);
  });
});
