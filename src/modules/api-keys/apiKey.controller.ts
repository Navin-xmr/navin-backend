import type { RequestHandler } from 'express';
import { generateApiKey, revokeApiKey, listApiKeys } from '../auth/apiKey.service.js';
import { AppError } from '../../shared/http/errors.js';
import { ErrorCodes } from '../../shared/http/errors.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Creates an API key for the caller's organization.
 * organizationId is derived from req.user.organizationId (JWT).
 *
 * Response shape: { success, message, data: { key: ApiKeyMeta, secret: string } }
 * The `secret` is the raw unhashed key shown exactly once.
 *
 * @param req.body.name - Human-readable key label.
 * @param req.body.shipmentId - Optional shipment scope.
 * @returns HTTP 201 with { success, message, data: { key, secret } }
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / SUPER_ADMIN.
 * @throws {AppError} 400 VALIDATION_ERROR — when name is missing.
 */
export const createApiKeyController: RequestHandler = async (req, res) => {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    throw new AppError(
      403,
      'User must belong to an organization to create API keys',
      ErrorCodes.FORBIDDEN
    );
  }

  const { name, shipmentId } = req.body;

  const result = await generateApiKey({
    name,
    organizationId,
    shipmentId,
    createdBy: req.user?.userId,
  });

  // sendResponse wraps in { success, message, data }
  // So we pass { key, secret } as `data`
  // Final: { success, message, data: { key: {...}, secret: "..." } }
  sendResponse(
    res,
    201,
    true,
    'API key created successfully. Save this key securely — it will not be shown again.',
    {
      key: {
        id: result.id,
        name: result.name,
        organizationId: result.organizationId,
        shipmentId: result.shipmentId,
        createdAt: result.createdAt,
      },
      secret: result.apiKey,
    }
  );
};

/**
 * Lists active API keys for the caller's organization.
 * organizationId is derived from req.user.organizationId (JWT).
 *
 * @returns HTTP 200 with { success, message, data: ApiKeyRecord[] }
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / SUPER_ADMIN.
 */
export const listApiKeysController: RequestHandler = async (req, res) => {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    throw new AppError(
      403,
      'User must belong to an organization to list API keys',
      ErrorCodes.FORBIDDEN
    );
  }

  const apiKeys = await listApiKeys(organizationId);

  sendResponse(res, 200, true, 'API keys retrieved', apiKeys);
};

/**
 * Revokes (soft-deletes) an API key by id.
 * Only keys belonging to the caller's organization can be revoked.
 *
 * @param req.params.apiKeyId - API key document id to revoke.
 * @returns HTTP 200 with { success, message, data: null }
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / SUPER_ADMIN.
 * @throws {AppError} 404 NOT_FOUND — when no API key matches the id.
 */
export const revokeApiKeyController: RequestHandler = async (req, res) => {
  const { apiKeyId } = req.params;
  const organizationId = req.user?.organizationId;

  if (!apiKeyId) {
    throw new AppError(400, 'apiKeyId is required', ErrorCodes.VALIDATION_ERROR);
  }

  // Verify the key belongs to the caller's org before revoking
  const keys = await listApiKeys(organizationId!);
  type ApiKeyRecord = {
    _id?: string;
    id?: string;
    [key: string]: unknown;
  };
  const key = keys.find((k: ApiKeyRecord) => k._id?.toString() === apiKeyId || k.id === apiKeyId);
  if (!key) {
    throw new AppError(
      404,
      'API key not found or does not belong to your organization',
      ErrorCodes.NOT_FOUND
    );
  }

  await revokeApiKey(apiKeyId);

  sendResponse(res, 200, true, 'API key revoked successfully', null);
};
