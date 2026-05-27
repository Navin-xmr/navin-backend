import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { z } from 'zod';
import {
  AcceptInvitationBodySchema,
  CreateInvitationBodySchema,
  CreateUserBodySchema,
  VerifyInvitationQuerySchema,
} from './users.validation.js';
import {
  acceptInvitationController,
  createInvitationController,
  createUserController,
  deleteUserController,
  verifyInvitationController,
} from './users.controller.js';
import { CreateUserBodySchema } from './users.validation.js';
import { createUserController, deleteUserController, listUsersController } from './users.controller.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';

import { UserRole } from '../../shared/constants/index.js';

export const usersRouter = Router();

usersRouter.post(
  '/',
  validateRequest({ body: CreateUserBodySchema }),
  asyncHandler(createUserController)
);
usersRouter.post(
  '/invitations',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ body: CreateInvitationBodySchema }),
  asyncHandler(createInvitationController)
);
usersRouter.get(
  '/invitations/verify',
  validateRequest({ query: VerifyInvitationQuerySchema }),
  asyncHandler(verifyInvitationController)
);
usersRouter.post(
  '/invitations/accept',
  validateRequest({ body: AcceptInvitationBodySchema }),
  asyncHandler(acceptInvitationController)
usersRouter.get(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN),
  asyncHandler(listUsersController)
);
usersRouter.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: z.object({ id: z.string().trim().min(1) }) }),
  asyncHandler(deleteUserController)
);
