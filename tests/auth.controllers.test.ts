import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AppError } from '../src/shared/http/errors.js';

describe('Auth and User Controllers', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function makeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;
  }

  it('createApiKeyController returns 201 with created key payload', async () => {
    const generateApiKey = jest.fn(async () => ({
      apiKey: 'raw-key',
      id: '507f1f77bcf86cd799439011',
      name: 'Key',
      organizationId: '507f1f77bcf86cd799439012',
      createdAt: new Date(),
    }));

    await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
      generateApiKey,
      listApiKeys: jest.fn(),
      revokeApiKey: jest.fn(),
      validateApiKey: jest.fn(),
    }));

    const { createApiKeyController } = await import('../src/modules/auth/apiKey.controller.js');
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
    await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
      generateApiKey: jest.fn(),
      listApiKeys: jest.fn(),
      revokeApiKey: jest.fn(),
      validateApiKey: jest.fn(),
    }));

    const { createApiKeyController } = await import('../src/modules/auth/apiKey.controller.js');
    const req = { body: { name: 'Key' } } as Request;
    const res = makeRes();

    await expect(createApiKeyController(req, res, jest.fn())).rejects.toThrow(
      'name and organizationId are required'
    );
  });

  it('listApiKeysController returns list and revokeApiKeyController revokes', async () => {
    const listApiKeys = jest.fn(async () => [{ _id: 'k1', name: 'Key 1', isActive: true }]);
    const revokeApiKey = jest.fn(async () => undefined);

    await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
      generateApiKey: jest.fn(),
      listApiKeys,
      revokeApiKey,
      validateApiKey: jest.fn(),
    }));

    const { listApiKeysController, revokeApiKeyController } = await import(
      '../src/modules/auth/apiKey.controller.js'
    );

    const listReq = { params: { organizationId: 'org1' } } as unknown as Request;
    const listRes = makeRes();
    await listApiKeysController(listReq, listRes, jest.fn());
    expect(listRes.status).toHaveBeenCalledWith(200);
    expect(listRes.json).toHaveBeenCalledWith({ data: [{ _id: 'k1', name: 'Key 1', isActive: true }] });

    const revokeReq = { params: { apiKeyId: 'k1' } } as unknown as Request;
    const revokeRes = makeRes();
    await revokeApiKeyController(revokeReq, revokeRes, jest.fn());
    expect(revokeApiKey).toHaveBeenCalledTimes(1);
    expect(revokeRes.status).toHaveBeenCalledWith(200);
  });

  it('signupController and loginController map service outputs to response body', async () => {
    const signup = jest.fn(async () => ({
      user: { id: 'u1', email: 'u@example.com', name: 'User', role: 'user' },
      token: 'token-signup',
    }));
    const login = jest.fn(async () => ({
      user: { id: 'u1', email: 'u@example.com', name: 'User', role: 'user' },
      token: 'token-login',
    }));

    await jest.unstable_mockModule('../src/modules/auth/auth.service.js', () => ({
      signup,
      login,
      verifyToken: jest.fn(),
    }));

    const { signupController, loginController } = await import('../src/modules/auth/auth.controller.js');

    const signupReq = { body: { email: 'u@example.com', name: 'User', password: 'Password123!' } } as Request;
    const signupRes = makeRes();
    await signupController(signupReq, signupRes, jest.fn());
    expect(signupRes.status).toHaveBeenCalledWith(201);
    expect(signupRes.json).toHaveBeenCalledWith({ data: expect.objectContaining({ token: 'token-signup' }) });

    const loginReq = { body: { email: 'u@example.com', password: 'Password123!' } } as Request;
    const loginRes = makeRes();
    await loginController(loginReq, loginRes, jest.fn());
    expect(loginRes.status).toHaveBeenCalledWith(200);
    expect(loginRes.json).toHaveBeenCalledWith({ data: expect.objectContaining({ token: 'token-login' }) });
  });

  it('createUserController returns 201 with user payload', async () => {
    const registerUser = jest.fn(async () => ({ _id: 'u1', email: 'u@example.com', name: 'User' }));

    await jest.unstable_mockModule('../src/modules/users/users.service.js', () => ({
      registerUser,
    }));

    const { createUserController } = await import('../src/modules/users/users.controller.js');

    const req = { body: { email: 'u@example.com', name: 'User' } } as Request;
    const res = makeRes();
    await createUserController(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'u@example.com' }) });
  });
});
