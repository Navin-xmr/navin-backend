import type { RequestHandler } from 'express';
import { generateApiKey, revokeApiKey, listApiKeys } from './apiKey.service.js';
import { AppError } from '../../shared/http/errors.js';

export const createApiKeyController: RequestHandler = async (req, res) => {
  const { name, organizationId, shipmentId } = req.body;

  if (!name || !organizationId) {
    throw new AppError(400, 'name and organizationId are required', 'VALIDATION_ERROR');
  }

  const result = await generateApiKey({ name, organizationId, shipmentId });

  res.status(201).json({
    message: 'API key created successfully. Save this key securely - it will not be shown again.',
    data: result,
  });
};

export const listApiKeysController: RequestHandler = async (req, res) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    throw new AppError(400, 'organizationId is required', 'VALIDATION_ERROR');
  }

  const apiKeys = await listApiKeys(organizationId);

  res.status(200).json({ data: apiKeys });
};

export const revokeApiKeyController: RequestHandler = async (req, res) => {
  const { apiKeyId } = req.params;

  if (!apiKeyId) {
    throw new AppError(400, 'apiKeyId is required', 'VALIDATION_ERROR');
  }

  await revokeApiKey(apiKeyId);

  res.status(200).json({ message: 'API key revoked successfully' });
};
