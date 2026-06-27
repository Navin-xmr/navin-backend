import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('ETag support (Issue #80)', () => {
  const app = buildApp();

  it('first request returns 200 with an ETag header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['etag']).toBeDefined();
  });

  it('subsequent request with matching If-None-Match returns 304 Not Modified', async () => {
    const originalUptime = process.uptime;
    const originalDateNow = Date.now;
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');

    process.uptime = () => 123.456;
    Date.now = () => fixedTime.getTime();
    const OriginalDate = globalThis.Date;
    const FixedDate = function (...args: unknown[]) {
      if (args.length === 0) {
        return new OriginalDate(fixedTime.getTime());
      }
      return new (OriginalDate as unknown as { new (...a: unknown[]): Date })(...args);
    } as unknown as DateConstructor;
    FixedDate.now = () => fixedTime.getTime();
    FixedDate.parse = OriginalDate.parse;
    FixedDate.UTC = OriginalDate.UTC;
    Object.setPrototypeOf(FixedDate, OriginalDate);
    globalThis.Date = FixedDate;

    try {
      const first = await request(app).get('/api/health');
      const etag = first.headers['etag'] as string;

      const second = await request(app).get('/api/health').set('If-None-Match', etag);
      expect(second.status).toBe(304);
    } finally {
      process.uptime = originalUptime;
      Date.now = originalDateNow;
      globalThis.Date = OriginalDate;
    }
  });
});
