import type { Request, Response } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import {
  createTemplateService,
  listTemplatesService,
  getTemplateByIdService,
} from './template.service.js';
import type {
  CreateTemplateBody,
  ListTemplatesQuery,
  TemplateIdParam,
} from './template.validation.js';

/**
 * Creates a new template.
 * Route: `POST /api/templates`. Requires ADMIN or MANAGER.
 *
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the created template.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks an allowed role.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 * @throws {AppError} 409 ERR_DUPLICATE_KEY — when the template name already exists.
 */
export const createTemplateController = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateTemplateBody;
  const result = await createTemplateService(body);
  sendResponse(res, 201, true, 'Template created', result);
};

/**
 * Lists templates with offset pagination.
 * Route: `GET /api/templates`. Requires ADMIN, MANAGER, or VIEWER.
 *
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` (`page`, `limit`, `total`).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks an allowed role.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const listTemplatesController = async (req: Request, res: Response): Promise<void> => {
  const query = req.query as unknown as ListTemplatesQuery;
  const result = await listTemplatesService({
    page: Number(query.page),
    limit: Number(query.limit),
  });
  sendResponse(res, 200, true, 'Templates retrieved', result.data, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
};

/**
 * Retrieves a single template by id.
 * Route: `GET /api/templates/:id`. Requires ADMIN, MANAGER, or VIEWER.
 *
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the template.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks an allowed role.
 * @throws {AppError} 404 ERR_NOT_FOUND — when the template does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const getTemplateByIdController = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as unknown as TemplateIdParam;
  const result = await getTemplateByIdService(id);
  sendResponse(res, 200, true, 'Template retrieved', result);
};
