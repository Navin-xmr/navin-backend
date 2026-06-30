import type { RequestHandler } from 'express';
import { signup, login, logout, forgotPassword, resetPassword } from './auth.service.js';
import { signup, login, logout, refreshToken } from './auth.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

export const signupController: RequestHandler = async (req, res) => {
  const result = await signup(req.body);
  sendResponse(res, 201, true, 'Account created successfully', result);
};

export const loginController: RequestHandler = async (req, res) => {
  const result = await login(req.body);
  sendResponse(res, 200, true, 'Login successful', result);
};

export const logoutController: RequestHandler = async (req, res) => {
  const token = req.headers.authorization!.substring(7);
  await logout(token);
  sendResponse(res, 200, true, 'Logged out successfully', null);
};

export const forgotPasswordController: RequestHandler = async (req, res) => {
  await forgotPassword(req.body.email as string);
  sendResponse(res, 200, true, 'If the email exists, a reset link has been sent', null);
};

export const resetPasswordController: RequestHandler = async (req, res) => {
  await resetPassword(req.body.token as string, req.body.newPassword as string);
  sendResponse(res, 200, true, 'Password reset successfully', null);
export const refreshController: RequestHandler = async (req, res) => {
  const { token } = req.body as { token: string };
  const result = await refreshToken(token);
  sendResponse(res, 200, true, 'Token refreshed', result);
};
