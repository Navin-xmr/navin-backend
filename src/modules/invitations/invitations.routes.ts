import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/index.js';
import {
  createInvitationController,
  listInvitationsController,
  resendInvitationController,
  revokeInvitationController,
  getInvitationInfoController,
  acceptInvitationController,
} from './invitations.controller.js';
import {
  CreateInvitationBodySchema,
  ListInvitationsQuerySchema,
  InvitationIdParamSchema,
  AcceptInvitationBodySchema,
  InvitationInfoQuerySchema,
} from './invitations.validation.js';

export const invitationsRouter = Router();

/**
 * POST /api/company/invitations
 * Create and send an invitation (requires ADMIN).
 */
invitationsRouter.post(
  '/',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ body: CreateInvitationBodySchema }),
  asyncHandler(createInvitationController)
);

/**
 * GET /api/company/invitations
 * List invitations for the organization (requires ADMIN).
 */
invitationsRouter.get(
  '/',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ query: ListInvitationsQuerySchema }),
  asyncHandler(listInvitationsController)
);

/**
 * POST /api/company/invitations/:id/resend
 * Resend an invitation (requires ADMIN).
 */
invitationsRouter.post(
  '/:id/resend',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: InvitationIdParamSchema }),
  asyncHandler(resendInvitationController)
);

/**
 * DELETE /api/company/invitations/:id
 * Revoke an invitation (requires ADMIN).
 */
invitationsRouter.delete(
  '/:id',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: InvitationIdParamSchema }),
  asyncHandler(revokeInvitationController)
);

/**
 * GET /api/company/invitations/info
 * Get invitation info from token (public endpoint).
 */
// PUBLIC: token lookup for invitation preview
invitationsRouter.get(
  '/info',
  validateRequest({ query: InvitationInfoQuerySchema }),
  asyncHandler(getInvitationInfoController)
);

/**
 * POST /api/company/invitations/accept
 * Accept invitation and create user account (public endpoint).
 */
// PUBLIC: accepts invitation and creates user account
invitationsRouter.post(
  '/accept',
  validateRequest({ body: AcceptInvitationBodySchema }),
  asyncHandler(acceptInvitationController)
);
