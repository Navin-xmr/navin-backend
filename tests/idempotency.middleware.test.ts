import { describe, expect, it, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { idempotency } from '../src/shared/middleware/idempotency.js';
import { resetInMemoryRedisForTest } from '../src/infra/redis/connection.js';
import { errorMiddleware } from '../src/shared/http/errorMiddleware.js';

function buildApp(handler: () => Promise<void> | void) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { userId: 'u1', role: 'ADMIN', organizationId: 'org1', jti: 'j' };
    next();
  });
  app.post('/chain', idempotency(), async (_req, res) => {
    await handler();
    res.status(201).json({ success: true, data: { tx: 'abc' } });
  });
  app.use(errorMiddleware());
  return app;
}

const KEY = 'key-12345678';

describe('idempotency middleware (#1061)', () => {
  beforeEach(() => resetInMemoryRedisForTest());

  it('replays the stored result for a duplicate key without re-running the handler', async () => {
    let calls = 0;
    const app = buildApp(() => {
      calls += 1;
    });
    const first = await request(app).post('/chain').set('Idempotency-Key', KEY).send({ a: 1 });
    const second = await request(app).post('/chain').set('Idempotency-Key', KEY).send({ a: 1 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(calls).toBe(1);
  });

  it('two concurrent identical requests produce one chain submission', async () => {
    let calls = 0;
    const app = buildApp(async () => {
      calls += 1;
      await new Promise(r => setTimeout(r, 50));
    });
    const [a, b] = await Promise.all([
      request(app).post('/chain').set('Idempotency-Key', KEY).send({ a: 1 }),
      request(app).post('/chain').set('Idempotency-Key', KEY).send({ a: 1 }),
    ]);
    expect(calls).toBe(1);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('rejects a reused key with a different body', async () => {
    const app = buildApp(() => undefined);
    await request(app).post('/chain').set('Idempotency-Key', KEY).send({ a: 1 });
    const res = await request(app).post('/chain').set('Idempotency-Key', KEY).send({ a: 2 });
    expect(res.status).toBe(422);
  });

  it('scopes keys per organization', async () => {
    let calls = 0;
    const app = buildApp(() => {
      calls += 1;
    });
    await request(app).post('/chain').set('Idempotency-Key', KEY).send({});
    // Same key from another org is a fresh request.
    const other = express();
    other.use(express.json());
    other.use((req, _res, next) => {
      req.user = { userId: 'u2', role: 'ADMIN', organizationId: 'org2', jti: 'j' };
      next();
    });
    other.post('/chain', idempotency(), (_req, res) => {
      calls += 1;
      res.status(201).json({ ok: true });
    });
    await request(other).post('/chain').set('Idempotency-Key', KEY).send({});
    expect(calls).toBe(2);
  });

  it('passes through when no header is sent and rejects malformed keys', async () => {
    let calls = 0;
    const app = buildApp(() => {
      calls += 1;
    });
    await request(app).post('/chain').send({});
    await request(app).post('/chain').send({});
    expect(calls).toBe(2);
    const bad = await request(app).post('/chain').set('Idempotency-Key', 'short').send({});
    expect(bad.status).toBe(400);
  });
});
