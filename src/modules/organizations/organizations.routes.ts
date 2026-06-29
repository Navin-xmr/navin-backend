import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import {
  CreateOrganizationBodySchema,
  OrganizationIdParamSchema,
  UpdateOrganizationBodySchema,
} from './organizations.validation.js';
import {
  createOrganizationController,
  listOrganizationsController,
  getOrganizationController,
  updateOrganizationController,
  deleteOrganizationController,
} from './organizations.controller.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/index.js';

export const organizationsRouter = Router();

organizationsRouter.post(
  '/',
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateRequest({ body: CreateOrganizationBodySchema }),
  asyncHandler(createOrganizationController)
);

organizationsRouter.get(
  '/',
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  asyncHandler(listOrganizationsController)
);

organizationsRouter.get(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: OrganizationIdParamSchema }),
  asyncHandler(getOrganizationController)
);

organizationsRouter.patch(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: OrganizationIdParamSchema, body: UpdateOrganizationBodySchema }),
  asyncHandler(updateOrganizationController)
);

organizationsRouter.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateRequest({ params: OrganizationIdParamSchema }),
  asyncHandler(deleteOrganizationController)
);

export default organizationsRouter;