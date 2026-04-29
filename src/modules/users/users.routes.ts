import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { z } from 'zod';
import { CreateUserBodySchema } from './users.validation.js';
import { createUserController, deleteUserController } from './users.controller.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';

import { UserRole } from '../../shared/constants/index.js';

export const usersRouter = Router();

usersRouter.post(
  '/',
  validateRequest({ body: CreateUserBodySchema }),
  asyncHandler(createUserController)
);
usersRouter.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: z.object({ id: z.string().trim().min(1) }) }),
  asyncHandler(deleteUserController)
);
