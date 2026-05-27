import type { RequestHandler } from 'express';
import * as usersService from './users.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

export const createUserController: RequestHandler = async (req, res) => {
  const user = await usersService.registerUser(req.body);
  sendResponse(res, 201, true, 'User registered successfully', user);
};

export const deleteUserController: RequestHandler = async (req, res) => {
  await usersService.deleteUser(req.params.id);
  res.json({ success: true, message: 'User deleted successfully' });
};

export const createInvitationController: RequestHandler = async (req, res) => {
  const invitation = await usersService.generateInvitationLink({
    email: req.body.email,
    role: req.body.role,
    inviterUserId: req.user?.userId ?? '',
    inviterRole: req.user?.role,
    organizationId: req.user?.organizationId,
  });

  sendResponse(res, 201, true, 'Invitation link generated successfully', invitation);
};

export const verifyInvitationController: RequestHandler = async (req, res) => {
  const invite = usersService.verifyInvitationToken(String(req.query.token));
  sendResponse(res, 200, true, 'Invitation token verified successfully', invite);
};

export const acceptInvitationController: RequestHandler = async (req, res) => {
  const user = await usersService.acceptInvitation({
    token: req.body.token,
    name: req.body.name,
    password: req.body.password,
  });

  sendResponse(res, 201, true, 'Invitation accepted successfully', user);
export const listUsersController: RequestHandler = async (req, res) => {
  const users = await usersService.listOrganizationUsers({
    organizationId: req.user?.organizationId,
    role: req.user?.role,
  });

  sendResponse(res, 200, true, 'Users retrieved successfully', users);
};
