import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { AppError } from '../src/shared/http/errors.js';
import type { NextFunction, Request, Response } from 'express';

type ValidateApiKeyResult = {
  isValid: boolean;
  apiKeyDoc?: {
    _id: string;
    organizationId: string;
    shipmentId?: string;
  };
};

const mockValidateApiKey = jest.fn<(_rawApiKey: string) => Promise<ValidateApiKeyResult>>();

describe('requireApiKey middleware', () => {
  let app: express.Application;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock the apiKey service
    await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
      validateApiKey: mockValidateApiKey,
    }));

    // Import requireApiKey after mocking
    const { requireApiKey: requireApiKeyMiddleware } = await import('../src/shared/middleware/requireApiKey.js');

    app = express();
    app.use(express.json());
    
    app.get('/test', async (req, res, next) => {
      try {
        await requireApiKeyMiddleware(req, res, next);
      } catch (error) {
        next(error);
      }
    }, (req, res) => {
      res.status(200).json({ 
        success: true,
        apiKey: req.apiKey,
      });
    });

    // Error handler
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message, code: err.code });
      } else {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });
  });

  it('allows access with valid API key', async () => {
    const mockApiKeyDoc = {
      _id: 'key123',
      organizationId: 'org456',
      shipmentId: 'ship789',
    };

    mockValidateApiKey.mockResolvedValue({
      isValid: true,
      apiKeyDoc: mockApiKeyDoc,
    });

    const res = await request(app)
      .get('/test')
      .set('x-api-key', 'valid-api-key-12345');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.apiKey).toEqual({
      id: 'key123',
      organizationId: 'org456',
      shipmentId: 'ship789',
    });
    expect(mockValidateApiKey).toHaveBeenCalledWith('valid-api-key-12345');
  });

  it('returns 401 when x-api-key header is missing', async () => {
    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Missing x-api-key header');
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is invalid', async () => {
    mockValidateApiKey.mockResolvedValue({
      isValid: false,
    });

    const res = await request(app)
      .get('/test')
      .set('x-api-key', 'invalid-api-key');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid API key');
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(mockValidateApiKey).toHaveBeenCalledWith('invalid-api-key');
  });

  it('returns 401 when validateApiKey throws an error', async () => {
    mockValidateApiKey.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .get('/test')
      .set('x-api-key', 'some-key');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid API key');
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('allows access with valid API key without shipmentId', async () => {
    const mockApiKeyDoc = {
      _id: 'key123',
      organizationId: 'org456',
    };

    mockValidateApiKey.mockResolvedValue({
      isValid: true,
      apiKeyDoc: mockApiKeyDoc,
    });

    const res = await request(app)
      .get('/test')
      .set('x-api-key', 'valid-api-key-no-shipment');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.apiKey).toEqual({
      id: 'key123',
      organizationId: 'org456',
      shipmentId: undefined,
    });
  });
});

