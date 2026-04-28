import type { RequestHandler } from 'express';
import { signup, login, logout } from './auth.service.js';
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
