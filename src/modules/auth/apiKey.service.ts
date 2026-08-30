import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { ApiKeyModel } from './apiKey.model.js';
import type { IApiKey } from '../../shared/types/apiKey.js';
import { AppError } from '../../shared/http/errors.js';
import { auditLog } from '../../shared/utils/auditLog.js';

interface CreateApiKeyParams {
  name: string;
  organizationId: string;
  shipmentId?: string;
  createdBy?: string;
}

interface CreateApiKeyResult {
  apiKey: string;
  id: string;
  name: string;
  organizationId: string;
  shipmentId?: string;
  createdAt: Date;
}

/**
 * Generates and persists a new API key for an organization or shipment.
 * @param {CreateApiKeyParams} params - API key creation parameters.
 * @returns {Promise<CreateApiKeyResult>} The generated raw API key and stored record metadata.
 */
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

  if (params.createdBy) {
    auditLog({
      userId: params.createdBy,
      action: 'API_KEY_GENERATED',
      resourceId: apiKeyDoc._id.toString(),
      timestamp: apiKeyDoc.createdAt,
      metadata: { organizationId: params.organizationId, name: params.name },
    });
  }

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

/**
 * Validates a raw API key against active stored keys.
 * @param {string} rawApiKey - The inbound raw API key value.
 * @returns {Promise<{isValid: boolean; apiKeyDoc?: IApiKey}>} Validation result and matched document if valid.
 */
export async function validateApiKey(rawApiKey: string): Promise<{
  isValid: boolean;
  apiKeyDoc?: IApiKey;
}> {
  if (!rawApiKey) {
    return { isValid: false };
  }

  // Find all active API keys (don't use .lean() here since we need document methods)
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

/**
 * Revokes an API key by marking it inactive.
 * @param {string} apiKeyId - ObjectId of the API key to revoke.
 * @throws {AppError} When the API key cannot be found.
 */
export async function revokeApiKey(apiKeyId: string): Promise<void> {
  const result = await ApiKeyModel.updateOne({ _id: apiKeyId }, { isActive: false });

  if (result.matchedCount === 0) {
    throw new AppError(404, 'API key not found', 'NOT_FOUND');
  }
}

/**
 * Lists active API keys for a given organization.
 * @param {string} organizationId - Organization ObjectId to list keys for.
 * @returns {Promise<unknown[]>} Active API keys filtered by organization.
 */
export async function listApiKeys(organizationId: string) {
  return ApiKeyModel.find({ organizationId, isActive: true })
    .select('-keyHash -__v')
    .sort({ createdAt: -1 })
    .lean();
}
