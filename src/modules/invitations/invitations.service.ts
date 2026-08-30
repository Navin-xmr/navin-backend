import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { env } from '../../env.js';
import { config } from '../../config/index.js';
import { UserRole } from '../../shared/constants/index.js';
import { UserModel, OrganizationModel } from '../users/users.model.js';
import { findUserByEmail } from '../users/users.repo.js';
import { logger } from '../../shared/logger/logger.js';
import { sendEmail, invitationEmailHtml } from '../../services/email.service.js';
import {
  createInvitation,
  findInvitationById,
  updateInvitationByTokenHash,
  revokeInvitation,
} from './invitations.repo.js';
import { InvitationModel, InvitationStatus } from './invitations.model.js';
import type {
  AcceptInvitationBody,
  CreateInvitationBody,
  InvitationIdParam,
  InvitationInfoQuery,
  ListInvitationsQuery,
} from './invitations.validation.js';

const INVITE_EXPIRY_SECONDS = 48 * 60 * 60; // 48 hours

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

type InviteTokenPayload = {
  type: 'COMPANY_INVITATION';
  invitationId: string;
  email: string;
  role: string;
  organizationId: string;
  nonce?: string;
};

function generateInvitationToken(payload: Omit<InviteTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'COMPANY_INVITATION' }, env.JWT_SECRET, {
    expiresIn: INVITE_EXPIRY_SECONDS,
  });
}

function verifyInvitationToken(token: string): InviteTokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as InviteTokenPayload;
    if (payload.type !== 'COMPANY_INVITATION') {
      throw new AppError(400, 'Invalid invitation token type', ErrorCodes.BAD_REQUEST);
    }
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'Invalid or expired invitation token', ErrorCodes.UNAUTHORIZED);
  }
}

/**
 * Create and send an invitation to a new team member.
 */
export async function createAndSendInvitation(input: {
  email: CreateInvitationBody['email'];
  role: CreateInvitationBody['role'];
  message?: CreateInvitationBody['message'];
  inviterId: string;
  inviterRole: string;
  organizationId: string;
}) {
  // Verify inviter permissions
  const role = input.role as string;
  if (role === UserRole.SUPER_ADMIN) {
    throw new AppError(400, 'Cannot invite SUPER_ADMIN users', 'INVALID_ROLE');
  }

  const allowedByRole: Record<string, string[]> = {
    [UserRole.SUPER_ADMIN]: [
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.DRIVER,
      UserRole.VIEWER,
      UserRole.CUSTOMER,
    ],
    [UserRole.ADMIN]: [UserRole.MANAGER, UserRole.DRIVER, UserRole.VIEWER, UserRole.CUSTOMER],
  };

  const allowedRoles = allowedByRole[input.inviterRole] ?? [];
  if (!allowedRoles.includes(role)) {
    throw new AppError(
      403,
      'Forbidden: insufficient role to invite this role',
      ErrorCodes.FORBIDDEN
    );
  }

  // Check email not already in use
  const existingUser = await findUserByEmail(input.email);
  if (existingUser) {
    throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  }

  // Check no pending invitation for this email
  const existingInvitation = await InvitationModel.findOne({
    email: input.email,
    organizationId: input.organizationId,
    status: InvitationStatus.PENDING,
  });
  if (existingInvitation) {
    throw new AppError(409, 'Invitation already pending for this email', 'DUPLICATE_KEY');
  }

  // Generate token and hash
  const token = generateInvitationToken({
    invitationId: '', // Will be set after creation
    email: input.email,
    role: input.role,
    organizationId: input.organizationId,
    nonce: crypto.randomUUID(),
  });

  // We need to create the invitation first to get the ID, then regenerate token with ID
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_SECONDS * 1000);

  const invitation = await createInvitation({
    email: input.email,
    role: input.role,
    tokenHash,
    expiresAt,
    message: input.message,
    invitedBy: input.inviterId,
    organizationId: input.organizationId,
  });

  // Regenerate token with actual invitation ID
  const finalToken = generateInvitationToken({
    invitationId: invitation._id?.toString() ?? '',
    email: input.email,
    role: input.role,
    organizationId: input.organizationId,
    nonce: crypto.randomUUID(),
  });

  const finalTokenHash = hashToken(finalToken);
  await updateInvitationByTokenHash(tokenHash, { tokenHash: finalTokenHash });

  // Send email
  const inviteLink = `${config.frontendUrl}/invitations/accept?token=${encodeURIComponent(finalToken)}`;
  const inviter = await UserModel.findById(input.inviterId);

  try {
    await sendEmail({
      to: input.email,
      subject: "You're invited to join Navin",
      html: invitationEmailHtml(inviteLink, inviter?.name),
    });
  } catch (err) {
    logger.error({ err, email: input.email }, 'Failed to send invitation email');
    // Don't fail the request if email fails; token is available in response
  }

  return {
    id: invitation._id,
    token: finalToken,
    email: input.email,
    expiresAt,
    expiresInSeconds: INVITE_EXPIRY_SECONDS,
  };
}

/**
 * List invitations for an organization with optional status filter.
 */
export async function listOrganizationInvitations(input: {
  organizationId: string;
  limit?: ListInvitationsQuery['limit'];
  cursor?: ListInvitationsQuery['cursor'];
  status?: ListInvitationsQuery['status'];
}) {
  const limit = input.limit ?? 20;
  const query: Record<string, unknown> = {
    organizationId: input.organizationId,
  };

  if (input.cursor) {
    query._id = { $lt: input.cursor };
  }

  if (input.status) {
    query.status = input.status;
  }

  const [data, total] = await Promise.all([
    InvitationModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    InvitationModel.countDocuments(query),
  ]);

  const hasMore = data.length > limit;
  if (hasMore) data.pop();

  return {
    data,
    total,
    hasMore,
    nextCursor: hasMore && data.length > 0 ? String(data[data.length - 1]._id) : null,
  };
}

/**
 * Resend an invitation (regenerate token and update expiry).
 */
export async function resendInvitation(
  invitationId: InvitationIdParam['id'],
  organizationId: string
) {
  const invitation = await findInvitationById(invitationId);
  if (!invitation) {
    throw new AppError(404, 'Invitation not found', ErrorCodes.NOT_FOUND);
  }

  if (invitation.organizationId.toString() !== organizationId) {
    throw new AppError(403, 'Forbidden', ErrorCodes.FORBIDDEN);
  }

  if (invitation.status !== InvitationStatus.PENDING) {
    throw new AppError(
      400,
      `Cannot resend ${invitation.status} invitation`,
      ErrorCodes.BAD_REQUEST
    );
  }

  // Generate new token
  const newToken = generateInvitationToken({
    invitationId,
    email: invitation.email,
    role: invitation.role,
    organizationId: invitation.organizationId.toString(),
    nonce: crypto.randomUUID(),
  });

  const newTokenHash = hashToken(newToken);
  const newExpiresAt = new Date(Date.now() + INVITE_EXPIRY_SECONDS * 1000);

  await updateInvitationByTokenHash(invitation.tokenHash, {
    tokenHash: newTokenHash,
    expiresAt: newExpiresAt,
  });

  // Send email
  const inviteLink = `${config.frontendUrl}/invitations/accept?token=${encodeURIComponent(newToken)}`;
  const inviter = await UserModel.findById(invitation.invitedBy);

  try {
    await sendEmail({
      to: invitation.email,
      subject: "Resend: You're invited to join Navin",
      html: invitationEmailHtml(inviteLink, inviter?.name),
    });
  } catch (err) {
    logger.error({ err, email: invitation.email }, 'Failed to send resent invitation email');
  }

  return {
    id: invitation._id,
    token: newToken,
    expiresAt: newExpiresAt,
    expiresInSeconds: INVITE_EXPIRY_SECONDS,
  };
}

/**
 * Revoke an invitation (set status to REVOKED).
 */
export async function revokeInvitationById(
  invitationId: InvitationIdParam['id'],
  organizationId: string
) {
  const invitation = await findInvitationById(invitationId);
  if (!invitation) {
    throw new AppError(404, 'Invitation not found', ErrorCodes.NOT_FOUND);
  }

  if (invitation.organizationId.toString() !== organizationId) {
    throw new AppError(403, 'Forbidden', ErrorCodes.FORBIDDEN);
  }

  const revoked = await revokeInvitation(invitationId);
  return revoked;
}

/**
 * Get invitation info from token (public endpoint).
 */
export async function getInvitationInfo(token: InvitationInfoQuery['token']) {
  const payload = verifyInvitationToken(token);

  const invitation = await findInvitationById(payload.invitationId);
  if (!invitation) {
    throw new AppError(404, 'Invitation not found', ErrorCodes.NOT_FOUND);
  }

  // Check if invitation is valid
  if (invitation.status !== InvitationStatus.PENDING) {
    throw new AppError(400, `Invitation is ${invitation.status}`, ErrorCodes.BAD_REQUEST);
  }

  if (new Date() > invitation.expiresAt) {
    // Mark as expired
    await updateInvitationByTokenHash(invitation.tokenHash, {
      status: InvitationStatus.EXPIRED,
    });
    throw new AppError(400, 'Invitation has expired', ErrorCodes.BAD_REQUEST);
  }

  // Get organization name
  const org = await OrganizationModel.findById(invitation.organizationId);

  return {
    invitationId: invitation._id,
    email: invitation.email,
    role: invitation.role,
    companyName: org?.name ?? 'Unknown Organization',
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Accept invitation and create user account.
 */
export async function acceptInvitationWithPassword(input: AcceptInvitationBody) {
  const payload = verifyInvitationToken(input.token);

  const invitation = await findInvitationById(payload.invitationId);
  if (!invitation) {
    throw new AppError(404, 'Invitation not found', ErrorCodes.NOT_FOUND);
  }

  if (invitation.status !== InvitationStatus.PENDING) {
    throw new AppError(400, `Invitation is ${invitation.status}`, ErrorCodes.BAD_REQUEST);
  }

  if (new Date() > invitation.expiresAt) {
    await updateInvitationByTokenHash(invitation.tokenHash, {
      status: InvitationStatus.EXPIRED,
    });
    throw new AppError(400, 'Invitation has expired', ErrorCodes.BAD_REQUEST);
  }

  // Check email not already in use
  const existingUser = await findUserByEmail(invitation.email);
  if (existingUser) {
    throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  }

  // Create user
  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await UserModel.create({
    email: invitation.email,
    name: input.name,
    passwordHash,
    role: invitation.role,
    organizationId: invitation.organizationId,
  });

  // Mark invitation as accepted
  await updateInvitationByTokenHash(invitation.tokenHash, {
    status: InvitationStatus.ACCEPTED,
  });

  return {
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
}
