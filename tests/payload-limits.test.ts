import request from 'supertest';
import { buildApp } from '../src/app.js';

const app = buildApp();

describe('Payload Limits', () => {
  it('rejects JSON payloads over 100kb on standard routes', async () => {
    const bigPayload = { data: 'x'.repeat(110 * 1024) };

    const res = await request(app)
      .post('/api/auth/signup')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(bigPayload));

    expect(res.status).toBe(413);
  });
});
