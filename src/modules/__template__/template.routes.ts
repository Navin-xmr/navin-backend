import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/index.js';
import {
  createTemplateController,
  listTemplatesController,
  getTemplateByIdController,
} from './template.controller.js';
import {
  CreateTemplateBodySchema,
  ListTemplatesQuerySchema,
  TemplateIdParamSchema,
} from './template.validation.js';

export const templateRouter = Router();

templateRouter.post(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ body: CreateTemplateBodySchema }),
  asyncHandler(createTemplateController)
);

templateRouter.get(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ query: ListTemplatesQuerySchema }),
  asyncHandler(listTemplatesController)
);

templateRouter.get(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: TemplateIdParamSchema }),
  asyncHandler(getTemplateByIdController)
);
