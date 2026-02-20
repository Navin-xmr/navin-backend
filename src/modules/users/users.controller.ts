import type { RequestHandler } from 'express';
import { registerUser } from './users.service.js';

export const createUserController: RequestHandler = async (req, res) => {
  const user = await registerUser(req.body);
  res.status(201).json({ data: user });
};
