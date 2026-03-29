import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { ApiKeyModel } from './apiKey.model.js';
import type { ApiKey } from './apiKey.model.js';
import { AppError } from '../../shared/http/errors.js';

interface CreateApiKeyParams {
  name: string;
  organizationId: string;
  shipmentId?: string;
}

interface CreateApiKeyResult {
  apiKey: string;
  id: string;
  name: string;
  organizationId: string;
  shipmentId?: string;
  createdAt: Date;
}

export async function generateApiKey(params: CreateApiKeyParams): Promise<CreateApiKeyResult> {
  // Generate a secure random API key (32 bytes = 64 hex characters)
  const rawApiKey = crypto.randomBytes(32).toString('hex');

  // Hash the API key before storing
  const salt = await bcrypt.genSalt(10);
  const keyHash = await bcrypt.hash(rawApiKey, salt);

  const apiKeyDoc = await ApiKeyModel.create({
    name: params.name,
    keyHash,
    organizationId: params.organizationId,
    shipmentId: params.shipmentId,
    isActive: true,
  });

  // Return the raw API key only once - it will never be shown again
  return {
    apiKey: rawApiKey,
    id: apiKeyDoc._id.toString(),
    name: apiKeyDoc.name,
    organizationId: apiKeyDoc.organizationId.toString(),
    shipmentId: apiKeyDoc.shipmentId?.toString(),
    createdAt: apiKeyDoc.createdAt,
  };
}

export async function validateApiKey(rawApiKey: string): Promise<{
  isValid: boolean;
  apiKeyDoc?: ApiKey;
}> {
  if (!rawApiKey) {
    return { isValid: false };
  }

  // Find all active API keys and check against the hash
  const apiKeys = await ApiKeyModel.find({ isActive: true });

  for (const apiKeyDoc of apiKeys) {
    const isMatch = await bcrypt.compare(rawApiKey, apiKeyDoc.keyHash);
    if (isMatch) {
      // Update last used timestamp
      await ApiKeyModel.updateOne({ _id: apiKeyDoc._id }, { lastUsedAt: new Date() });

      return { isValid: true, apiKeyDoc };
    }
  }

  return { isValid: false };
}

export async function revokeApiKey(apiKeyId: string): Promise<void> {
  const result = await ApiKeyModel.updateOne({ _id: apiKeyId }, { isActive: false });

  if (result.matchedCount === 0) {
    throw new AppError(404, 'API key not found', 'NOT_FOUND');
  }
}

export async function listApiKeys(organizationId: string) {
  return ApiKeyModel.find({ organizationId, isActive: true })
    .select('-keyHash')
    .sort({ createdAt: -1 });
}
