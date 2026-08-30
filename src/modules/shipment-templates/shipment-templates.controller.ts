import { Request, Response } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import type { CreateTemplateBody, UpdateTemplateBody } from './shipment-templates.validation.js';
import {
  createTemplateService,
  getTemplatesService,
  getTemplateByIdService,
  updateTemplateService,
  deleteTemplateService,
} from './shipment-templates.service.js';

/**
 * Lists shipment templates for the caller's organization.
 * Requires auth and ADMIN / MANAGER / VIEWER.
 *
 * @returns HTTP 200 with envelope `{ success, message, data }` containing templates.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or organization context is missing.
 */
export const getTemplates = async (req: Request, res: Response) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    throw new AppError(403, 'Organization context required', ErrorCodes.FORBIDDEN);
  }
  const templates = await getTemplatesService(organizationId);
  sendResponse(res, 200, true, 'Templates retrieved', templates);
};

/**
 * Retrieves a shipment template by id within the caller's organization.
 * Requires auth and ADMIN / MANAGER / VIEWER.
 *
 * @param req.params.id - Template id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the template.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or organization context is missing.
 * @throws {AppError} 404 ERR_TEMPLATE_NOT_FOUND — when missing or cross-org access is attempted.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const getTemplateById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    throw new AppError(403, 'Organization context required', ErrorCodes.FORBIDDEN);
  }
  const template = await getTemplateByIdService(id, organizationId);
  sendResponse(res, 200, true, 'Template retrieved', template);
};

/**
 * Creates a shipment template for the caller's organization.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.body.name - Template name (1–200 chars).
 * @param req.body.fields - Optional default shipment field values.
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the created template.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or organization context is missing.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 */
export const createTemplate = async (req: Request, res: Response) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    throw new AppError(403, 'Organization context required', ErrorCodes.FORBIDDEN);
  }
  const body = req.body as CreateTemplateBody;
  const template = await createTemplateService(organizationId, body);
  sendResponse(res, 201, true, 'Template created', template);
};

/**
 * Updates a shipment template by id within the caller's organization.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Template id.
 * @param req.body.name - Optional new name.
 * @param req.body.fields - Optional fields patch (at least one of name/fields required).
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the updated template.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or organization context is missing.
 * @throws {AppError} 404 ERR_TEMPLATE_NOT_FOUND — when missing or cross-org access is attempted.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const updateTemplate = async (req: Request, res: Response) => {
  const { id } = req.params;
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    throw new AppError(403, 'Organization context required', ErrorCodes.FORBIDDEN);
  }
  const body = req.body as UpdateTemplateBody;
  const template = await updateTemplateService(id, organizationId, body);
  sendResponse(res, 200, true, 'Template updated', template);
};

/**
 * Deletes a shipment template by id within the caller's organization.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Template id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the deleted template.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or organization context is missing.
 * @throws {AppError} 404 ERR_TEMPLATE_NOT_FOUND — when missing or cross-org access is attempted.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const deleteTemplate = async (req: Request, res: Response) => {
  const { id } = req.params;
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    throw new AppError(403, 'Organization context required', ErrorCodes.FORBIDDEN);
  }
  const template = await deleteTemplateService(id, organizationId);
  sendResponse(res, 200, true, 'Template deleted', template);
};
