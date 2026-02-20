import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validate } from '../../shared/validation/validate.js';
import { SignupBodySchema, LoginBodySchema } from './auth.validation.js';
import { signupController, loginController } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/signup', validate({ body: SignupBodySchema }), asyncHandler(signupController));
authRouter.post('/login', validate({ body: LoginBodySchema }), asyncHandler(loginController));
