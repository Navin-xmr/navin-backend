import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('Health Check Endpoint', () => {
  const app = buildApp();

  it('GET /api/health should return 200 OK and { status: "active" }', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'active' });
  });
});
