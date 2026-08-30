import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/index.js';
import {
  CreateTemplateBodySchema,
  UpdateTemplateBodySchema,
  TemplateIdParamSchema,
} from './shipment-templates.validation.js';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from './shipment-templates.controller.js';

export const shipmentTemplatesRouter = Router();

shipmentTemplatesRouter.get(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  asyncHandler(getTemplates)
);

shipmentTemplatesRouter.get(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: TemplateIdParamSchema }),
  asyncHandler(getTemplateById)
);

shipmentTemplatesRouter.post(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ body: CreateTemplateBodySchema }),
  asyncHandler(createTemplate)
);

shipmentTemplatesRouter.patch(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ params: TemplateIdParamSchema, body: UpdateTemplateBodySchema }),
  asyncHandler(updateTemplate)
);

shipmentTemplatesRouter.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ params: TemplateIdParamSchema }),
  asyncHandler(deleteTemplate)
);

export default shipmentTemplatesRouter;
