import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('Health Check Endpoint', () => {
  const app = buildApp();

  it('GET /api/health should return 200 OK with standard response wrapper', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    // Partial match: required envelope + status, allowing dynamic uptime/timestamp (Issue #249)
    expect(response.body).toMatchObject({
      success: true,
      message: 'OK',
      data: {
        status: 'active',
        uptime: expect.any(Number),
        timestamp: expect.any(String),
      },
    });
  });
});
