import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validate } from '../../shared/validation/validate.js';
import { CreateUserBodySchema } from './users.validation.js';
import { createUserController } from './users.controller.js';

export const usersRouter = Router();

usersRouter.post('/', validate({ body: CreateUserBodySchema }), asyncHandler(createUserController));
