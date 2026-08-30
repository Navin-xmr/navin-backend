import { jest, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import type { Application } from 'express';
import jwt from 'jsonwebtoken';

await jest.unstable_mockModule('../src/shared/middleware/rateLimiter.js', () => ({
  standardLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  strictLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  otpLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { buildApp } = await import('../src/app.js');

type Method = 'delete' | 'get' | 'patch' | 'post' | 'put';
type Contract = {
  method: Method;
  path: string;
  protected: boolean;
};

const implementedContracts: Contract[] = [
  { method: 'post', path: '/api/auth/login', protected: false },
  { method: 'post', path: '/api/auth/signup', protected: false },
  { method: 'post', path: '/api/auth/register/company', protected: false },
  { method: 'post', path: '/api/auth/logout', protected: true },
  { method: 'post', path: '/api/auth/refresh', protected: false },
  { method: 'post', path: '/api/auth/forgot-password', protected: false },
  { method: 'post', path: '/api/auth/reset-password', protected: false },
  { method: 'get', path: '/api/auth/sessions', protected: true },
  { method: 'delete', path: '/api/auth/sessions/:id', protected: true },
  { method: 'post', path: '/api/auth/2fa/setup', protected: true },
  { method: 'post', path: '/api/auth/2fa/verify', protected: true },
  { method: 'delete', path: '/api/auth/2fa', protected: true },
  { method: 'post', path: '/api/auth/2fa/backup-codes/regenerate', protected: true },
  { method: 'get', path: '/api/users', protected: true },
  { method: 'get', path: '/api/users/me', protected: true },
  { method: 'get', path: '/api/company/invitations', protected: true },
  { method: 'post', path: '/api/company/invitations', protected: true },
  { method: 'post', path: '/api/company/invitations/:id/resend', protected: true },
  { method: 'delete', path: '/api/company/invitations/:id', protected: true },
  { method: 'get', path: '/api/company/invitations/info', protected: false },
  { method: 'post', path: '/api/company/invitations/accept', protected: false },
  { method: 'get', path: '/api/company/api-keys', protected: true },
  { method: 'post', path: '/api/company/api-keys', protected: true },
  { method: 'delete', path: '/api/company/api-keys/:id', protected: true },
  { method: 'get', path: '/api/shipments', protected: true },
  { method: 'get', path: '/api/shipments/:id', protected: true },
  { method: 'post', path: '/api/shipments', protected: true },
  { method: 'patch', path: '/api/shipments/:id', protected: true },
  { method: 'patch', path: '/api/shipments/:id/status', protected: true },
  { method: 'patch', path: '/api/shipments/bulk-status', protected: true },
  { method: 'delete', path: '/api/shipments/:id', protected: true },
  { method: 'post', path: '/api/shipments/:id/documents', protected: true },
  { method: 'post', path: '/api/shipments/:id/photos', protected: true },
  { method: 'get', path: '/api/analytics/performance', protected: true },
  { method: 'get', path: '/api/analytics/summary', protected: true },
  { method: 'get', path: '/api/settlements', protected: true },
  { method: 'get', path: '/api/settlements/summary', protected: true },
  { method: 'get', path: '/api/settlements/:id', protected: true },
  { method: 'get', path: '/api/ledger/blocks', protected: true },
  { method: 'get', path: '/api/ledger/blocks/:id', protected: true },
  { method: 'get', path: '/api/anomalies', protected: true },
  { method: 'patch', path: '/api/anomalies/:id/resolve', protected: true },
  { method: 'get', path: '/api/notifications', protected: true },
  { method: 'patch', path: '/api/notifications/:id/read', protected: true },
  { method: 'post', path: '/api/notifications/read-all', protected: true },
  { method: 'delete', path: '/api/notifications/:id', protected: true },
  { method: 'get', path: '/api/notifications/unread-count', protected: true },
  { method: 'get', path: '/api/notifications/preferences', protected: true },
  { method: 'patch', path: '/api/notifications/preferences', protected: true },
  { method: 'post', path: '/api/notifications/phone/send-otp', protected: true },
  { method: 'post', path: '/api/notifications/phone/verify-otp', protected: true },
  { method: 'get', path: '/api/activity', protected: true },
  { method: 'get', path: '/api/shipment-templates', protected: true },
  { method: 'post', path: '/api/shipment-templates', protected: true },
  { method: 'patch', path: '/api/shipment-templates/:id', protected: true },
  { method: 'delete', path: '/api/shipment-templates/:id', protected: true },
  { method: 'get', path: '/api/events', protected: true },
  { method: 'get', path: '/api/events/poll', protected: true },
];

const malformedBody = {
  post: { email: 'not-an-email' },
  patch: {},
  put: {},
  get: undefined,
  delete: undefined,
};

const requestPath = (path: string) => path.replace(':id', 'invalid-id').replace(':photoId', 'invalid-photo-id');

async function callEndpoint(app: Application, contract: Contract) {
  const requestBuilder = request(app)[contract.method](requestPath(contract.path));
  const body = malformedBody[contract.method];
  return body ? requestBuilder.send(body) : requestBuilder;
}

describe('backend integration requirements contract', () => {
  const app = buildApp();

  it('registers every implemented contract with the documented method', async () => {
    const responses = await Promise.all(implementedContracts.map(contract => callEndpoint(app, contract)));

    responses.forEach((response, index) => {
      const contract = implementedContracts[index];
      if (response.status === 404) {
        throw new Error(`${contract.method.toUpperCase()} ${contract.path} is not registered`);
      }
    });
  });

  it('requires authentication on every protected contract', async () => {
    const protectedContracts = implementedContracts.filter(contract => contract.protected);
    const responses = await Promise.all(protectedContracts.map(contract => callEndpoint(app, contract)));

    responses.forEach((response, index) => {
      const contract = protectedContracts[index];
      expect(response.status).toBe(401);
    });
  });

  it('returns 403 when an authenticated caller has no permitted role', async () => {
    const token = jwt.sign({ userId: 'customer-id', role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const response = await request(app)
      .get('/api/shipments')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('returns the standard response envelope for the public health endpoint', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ success: true, data: expect.anything() }));
  });
});
