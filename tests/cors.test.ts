import request from 'supertest';
import { jest } from '@jest/globals';

async function loadAppWithAllowedOrigins(allowedOrigins: string) {
  process.env.ALLOWED_ORIGINS = allowedOrigins;
  jest.resetModules();
  const appModule = await import('../src/app.js');
  return appModule.buildApp();
}

describe('CORS configuration', () => {
  it('allows requests from configured origins', async () => {
    const app = await loadAppWithAllowedOrigins('https://allowed.example,https://app.example');

    const response = await request(app).get('/api/health').set('Origin', 'https://allowed.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example');
  });

  it('blocks requests from unlisted origins', async () => {
    const app = await loadAppWithAllowedOrigins('https://allowed.example');

    const response = await request(app).get('/api/health').set('Origin', 'https://blocked.example');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      message: 'CORS origin denied',
    });
  });

  it('handles preflight OPTIONS requests for allowed origins', async () => {
    const app = await loadAppWithAllowedOrigins('https://allowed.example');

    const response = await request(app)
      .options('/api/health')
      .set('Origin', 'https://allowed.example')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example');
  });
});
