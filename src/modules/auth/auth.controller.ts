import type { RequestHandler } from 'express';
import { signup, login } from './auth.service.js';

export const signupController: RequestHandler = async (req, res) => {
  const result = await signup(req.body);
  res.status(201).json({ data: result });
};

export const loginController: RequestHandler = async (req, res) => {
  const result = await login(req.body);
  res.status(200).json({ data: result });
};
