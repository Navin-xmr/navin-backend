import type { RequestHandler } from 'express';
import * as organizationsService from './organizations.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Creates an organization. Requires auth and SUPER_ADMIN.
 *
 * @param req.body.name - Organization name.
 * @param req.body.type - Organization type enum.
 * @param req.body.settings - Optional settings object.
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the created organization.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller is not SUPER_ADMIN.
 * @throws {AppError} 409 ERR_DUPLICATE_KEY — when an organization with the same identity already exists.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 */
export const createOrganizationController: RequestHandler = async (req, res) => {
  const organization = await organizationsService.createOrganizationService({
    name: req.body.name,
    type: req.body.type,
    settings: req.body.settings,
    callerRole: req.user?.role ?? '',
  });
  sendResponse(res, 201, true, 'Organization created successfully', organization);
};

/**
 * Lists all organizations. Requires auth and SUPER_ADMIN.
 *
 * @returns HTTP 200 with envelope `{ success, message, data }` containing organizations.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller is not SUPER_ADMIN.
 */
export const listOrganizationsController: RequestHandler = async (req, res) => {
  const organizations = await organizationsService.listOrganizationsService(req.user?.role ?? '');
  sendResponse(res, 200, true, 'Organizations retrieved successfully', organizations);
};

/**
 * Retrieves a single organization by id.
 * Requires auth and ADMIN / SUPER_ADMIN (org-scoped access enforced in service).
 *
 * @param req.params.id - Organization id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the organization.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or cross-org access is attempted.
 * @throws {AppError} 404 ERR_ORGANIZATION_NOT_FOUND — when the organization does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const getOrganizationController: RequestHandler = async (req, res) => {
  const organization = await organizationsService.getOrganizationService({
    id: req.params.id,
    callerRole: req.user?.role ?? '',
    callerOrganizationId: req.user?.organizationId,
  });
  sendResponse(res, 200, true, 'Organization retrieved successfully', organization);
};

/**
 * Updates an organization. Requires auth and ADMIN / SUPER_ADMIN.
 *
 * @param req.params.id - Organization id.
 * @param req.body.name - Optional new name.
 * @param req.body.settings - Optional settings patch.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the updated organization.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or cross-org modify is attempted.
 * @throws {AppError} 404 ERR_ORGANIZATION_NOT_FOUND — when the organization does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const updateOrganizationController: RequestHandler = async (req, res) => {
  const organization = await organizationsService.updateOrganizationService({
    id: req.params.id,
    updates: req.body,
    callerRole: req.user?.role ?? '',
    callerOrganizationId: req.user?.organizationId,
  });
  sendResponse(res, 200, true, 'Organization updated successfully', organization);
};

/**
 * Deletes an organization. Requires auth and SUPER_ADMIN.
 *
 * @param req.params.id - Organization id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the deleted organization.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller is not SUPER_ADMIN.
 * @throws {AppError} 404 ERR_ORGANIZATION_NOT_FOUND — when the organization does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const deleteOrganizationController: RequestHandler = async (req, res) => {
  const organization = await organizationsService.deleteOrganizationService({
    id: req.params.id,
    callerRole: req.user?.role ?? '',
  });
  sendResponse(res, 200, true, 'Organization deleted successfully', organization);
};
