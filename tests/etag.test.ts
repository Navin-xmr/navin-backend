import { afterEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('ETag support (Issue #80)', () => {
  const app = buildApp();

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
    // Freeze dynamic health fields so consecutive responses share an ETag (Issue #250)
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');
    jest.useFakeTimers({ now: fixedTime });
    jest.spyOn(process, 'uptime').mockReturnValue(123.456);

    const first = await request(app).get('/api/health');
    expect(first.status).toBe(200);
    const etag = first.headers['etag'] as string;
    expect(etag).toBeDefined();

    const second = await request(app).get('/api/health').set('If-None-Match', etag);
    expect(second.status).toBe(304);
  });
});
