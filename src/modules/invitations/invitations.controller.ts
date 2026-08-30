import type { RequestHandler } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import * as invitationsService from './invitations.service.js';
import type {
  AcceptInvitationBody,
  CreateInvitationBody,
  InvitationIdParam,
  InvitationInfoQuery,
  ListInvitationsQuery,
} from './invitations.validation.js';

/**
 * Create and send an invitation to a team member.
 * Requires auth and ADMIN role.
 *
 * @param req.body.email - Email address to invite
 * @param req.body.role - Role to assign to the invited user
 * @param req.body.message - Optional custom message
 * @returns HTTP 201 with envelope containing invitation details
 * @throws {AppError} 409 if email already in use or invitation pending
 * @throws {AppError} 403 if insufficient role
 */
export const createInvitationController: RequestHandler = async (req, res) => {
  const body = req.body as CreateInvitationBody;
  const result = await invitationsService.createAndSendInvitation({
    email: body.email,
    role: body.role,
    message: body.message,
    inviterId: req.user?.userId ?? '',
    inviterRole: req.user?.role ?? '',
    organizationId: req.user?.organizationId ?? '',
  });

  sendResponse(res, 201, true, 'Invitation sent successfully', result);
};

/**
 * List invitations for the organization.
 * Requires auth and ADMIN role.
 *
 * @param req.query.limit - Page size (default 20, max 100)
 * @param req.query.cursor - Optional cursor for pagination
 * @param req.query.status - Optional status filter (PENDING|ACCEPTED|EXPIRED|REVOKED)
 * @returns HTTP 200 with paginated list of invitations
 * @throws {AppError} 401 if not authenticated
 * @throws {AppError} 403 if insufficient role
 */
export const listInvitationsController: RequestHandler = async (req, res) => {
  const query = req.query as unknown as ListInvitationsQuery;
  const result = await invitationsService.listOrganizationInvitations({
    organizationId: req.user?.organizationId ?? '',
    limit: query.limit,
    cursor: query.cursor,
    status: query.status,
  });

  sendResponse(res, 200, true, 'Invitations retrieved successfully', result.data, {
    total: result.total,
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
  });
};

/**
 * Resend an invitation (generate new token, refresh expiry).
 * Requires auth and ADMIN role.
 *
 * @param req.params.id - Invitation ID
 * @returns HTTP 200 with new token
 * @throws {AppError} 404 if invitation not found
 * @throws {AppError} 403 if forbidden
 * @throws {AppError} 400 if invitation not in PENDING status
 */
export const resendInvitationController: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as InvitationIdParam;
  const result = await invitationsService.resendInvitation(id, req.user?.organizationId ?? '');

  sendResponse(res, 200, true, 'Invitation resent successfully', result);
};

/**
 * Revoke an invitation (set status to REVOKED).
 * Requires auth and ADMIN role.
 *
 * @param req.params.id - Invitation ID
 * @returns HTTP 200 with revoked invitation
 * @throws {AppError} 404 if invitation not found
 * @throws {AppError} 403 if forbidden
 */
export const revokeInvitationController: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as InvitationIdParam;
  const result = await invitationsService.revokeInvitationById(id, req.user?.organizationId ?? '');

  sendResponse(res, 200, true, 'Invitation revoked successfully', result);
};

/**
 * Get invitation info from token (public endpoint).
 * No authentication required.
 *
 * @param req.query.token - Invitation token
 * @returns HTTP 200 with invitation details (company name, email, role)
 * @throws {AppError} 401 if token is invalid or expired
 * @throws {AppError} 404 if invitation not found
 * @throws {AppError} 400 if invitation already accepted/revoked/expired
 */
export const getInvitationInfoController: RequestHandler = async (req, res) => {
  const { token } = req.query as unknown as InvitationInfoQuery;
  const result = await invitationsService.getInvitationInfo(token);

  sendResponse(res, 200, true, 'Invitation info retrieved successfully', result);
};

/**
 * Accept an invitation and create user account.
 * No authentication required (public endpoint).
 *
 * @param req.body.token - Invitation token
 * @param req.body.name - User display name
 * @param req.body.password - User password (minimum 8 characters)
 * @returns HTTP 201 with created user details
 * @throws {AppError} 401 if token is invalid or expired
 * @throws {AppError} 404 if invitation not found
 * @throws {AppError} 409 if email already in use
 * @throws {AppError} 400 if invitation not in PENDING status
 */
export const acceptInvitationController: RequestHandler = async (req, res) => {
  const body = req.body as AcceptInvitationBody;
  const result = await invitationsService.acceptInvitationWithPassword({
    token: body.token,
    name: body.name,
    password: body.password,
  });

  sendResponse(res, 201, true, 'Invitation accepted successfully', result);
};
