import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { mockModule } from './helpers/mockFactory.js';

// NOTE: mocks are registered ONCE at module scope (resetModules →
// unstable_mockModule → dynamic import). Re-registering per test does not
// re-isolate under --experimental-vm-modules: dynamic re-imports resolve from
// the stale registry, so later tests silently run against earlier mocks.
const generateApiKey = jest.fn();
const listApiKeys = jest.fn();
const revokeApiKey = jest.fn();
const validateApiKey = jest.fn();

const signup = jest.fn();
const login = jest.fn();
const logout = jest.fn();
const verifyToken = jest.fn();
const forgotPassword = jest.fn();
const resetPassword = jest.fn();

const registerUser = jest.fn();

jest.resetModules();

await mockModule('../src/modules/auth/apiKey.service.js', {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
});

await mockModule('../src/modules/auth/auth.service.js', {
  signup,
  login,
  logout,
  verifyToken,
  forgotPassword,
  resetPassword,
});

await mockModule('../src/modules/users/users.service.js', {
  registerUser,
});

const {
  createApiKeyController,
  listApiKeysController,
  revokeApiKeyController,
} = await import('../src/modules/auth/apiKey.controller.js');
const { signupController, loginController } = await import(
  '../src/modules/auth/auth.controller.js'
);
const { createUserController } = await import('../src/modules/users/users.controller.js');

describe('Auth and User Controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;
  }

  it('createApiKeyController returns 201 with created key payload', async () => {
    generateApiKey.mockResolvedValue({
      apiKey: 'raw-key',
      id: '507f1f77bcf86cd799439011',
      name: 'Key',
      organizationId: '507f1f77bcf86cd799439012',
      createdAt: new Date(),
    });

    const req = {
      body: { name: 'Key', organizationId: '507f1f77bcf86cd799439012' },
    } as Request;
    const res = makeRes();

    await createApiKeyController(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: '507f1f77bcf86cd799439011' }) })
    );
  });

  it('createApiKeyController throws when required fields are missing', async () => {
    const req = { body: { name: 'Key' } } as Request;
    const res = makeRes();

    await expect(createApiKeyController(req, res, jest.fn())).rejects.toThrow(
      'name and organizationId are required'
    );
  });

  it('listApiKeysController returns list and revokeApiKeyController revokes', async () => {
    listApiKeys.mockResolvedValue([{ _id: 'k1', name: 'Key 1', isActive: true }]);
    revokeApiKey.mockResolvedValue(undefined);

    const listReq = { params: { organizationId: 'org1' } } as unknown as Request;
    const listRes = makeRes();
    await listApiKeysController(listReq, listRes, jest.fn());
    expect(listRes.status).toHaveBeenCalledWith(200);
    expect(listRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ _id: 'k1', name: 'Key 1', isActive: true }] })
    );

    const revokeReq = { params: { apiKeyId: 'k1' } } as unknown as Request;
    const revokeRes = makeRes();
    await revokeApiKeyController(revokeReq, revokeRes, jest.fn());
    expect(revokeApiKey).toHaveBeenCalledTimes(1);
    expect(revokeRes.status).toHaveBeenCalledWith(200);
  });

  it('signupController and loginController map service outputs to response body', async () => {
    signup.mockResolvedValue({
      user: { id: 'u1', email: 'u@example.com', name: 'User', role: 'user' },
      token: 'token-signup',
    });
    login.mockResolvedValue({
      user: { id: 'u1', email: 'u@example.com', name: 'User', role: 'user' },
      token: 'token-login',
    });

    const signupReq = {
      body: { email: 'u@example.com', name: 'User', password: 'Password123!' },
      headers: {},
    } as unknown as Request;
    const signupRes = makeRes();
    await signupController(signupReq, signupRes, jest.fn());
    expect(signupRes.status).toHaveBeenCalledWith(201);
    expect(signupRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ token: 'token-signup' }) })
    );

    const loginReq = {
      body: { email: 'u@example.com', password: 'Password123!' },
      headers: {},
    } as unknown as Request;
    const loginRes = makeRes();
    await loginController(loginReq, loginRes, jest.fn());
    expect(loginRes.status).toHaveBeenCalledWith(200);
    expect(loginRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ token: 'token-login' }) })
    );
  });

  it('createUserController returns 201 with user payload', async () => {
    registerUser.mockResolvedValue({ _id: 'u1', email: 'u@example.com', name: 'User' });

    const req = { body: { email: 'u@example.com', name: 'User' } } as Request;
    const res = makeRes();
    await createUserController(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'u@example.com' }) })
    );
  });
});
