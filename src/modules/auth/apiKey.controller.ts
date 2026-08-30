import type { RequestHandler } from 'express';
import { generateApiKey, revokeApiKey, listApiKeys } from './apiKey.service.js';
import { AppError } from '../../shared/http/errors.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Creates an organization (or shipment-scoped) API key. Requires auth and ADMIN / SUPER_ADMIN.
 * The raw key is returned once and never shown again.
 *
 * @param req.body.name - Human-readable key label.
 * @param req.body.organizationId - Organization that owns the key.
 * @param req.body.shipmentId - Optional shipment scope for the key.
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the raw `apiKey` and metadata.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / SUPER_ADMIN.
 * @throws {AppError} 400 VALIDATION_ERROR — when `name` or `organizationId` is missing (controller guard).
 */
export const createApiKeyController: RequestHandler = async (req, res) => {
  const { name, organizationId, shipmentId } = req.body;

  if (!name || !organizationId) {
    throw new AppError(400, 'name and organizationId are required', 'VALIDATION_ERROR');
  }

  const result = await generateApiKey({
    name,
    organizationId,
    shipmentId,
    createdBy: req.user?.userId,
  });

  sendResponse(
    res,
    201,
    true,
    'API key created successfully. Save this key securely - it will not be shown again.',
    result
  );
};

/**
 * Lists active API keys for an organization. Requires auth and ADMIN / SUPER_ADMIN.
 *
 * @param req.params.organizationId - Organization whose keys to list.
 * @returns HTTP 200 with envelope `{ success, message, data }` (active keys without hashes).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / SUPER_ADMIN.
 * @throws {AppError} 400 VALIDATION_ERROR — when `organizationId` is missing (controller guard).
 */
export const listApiKeysController: RequestHandler = async (req, res) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    throw new AppError(400, 'organizationId is required', 'VALIDATION_ERROR');
  }

  const apiKeys = await listApiKeys(organizationId);

  sendResponse(res, 200, true, 'API keys retrieved', apiKeys);
};

/**
 * Revokes an API key by id (marks inactive). Requires auth and ADMIN / SUPER_ADMIN.
 *
 * @param req.params.apiKeyId - API key document id to revoke.
 * @returns HTTP 200 with envelope `{ success, message, data: null }`.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / SUPER_ADMIN.
 * @throws {AppError} 400 VALIDATION_ERROR — when `apiKeyId` is missing (controller guard).
 * @throws {AppError} 404 NOT_FOUND — when no API key matches the id.
 */
export const revokeApiKeyController: RequestHandler = async (req, res) => {
  const { apiKeyId } = req.params;

  if (!apiKeyId) {
    throw new AppError(400, 'apiKeyId is required', 'VALIDATION_ERROR');
  }

  await revokeApiKey(apiKeyId);

  sendResponse(res, 200, true, 'API key revoked successfully', null);
};
