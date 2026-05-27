import { AppError } from '../../shared/http/errors.js';
import { createUser, findUserByEmail, findUsersByOrganizationId } from './users.repo.js';
import { UserModel } from './users.model.js';
import jwt from 'jsonwebtoken';
import { env } from '../../env.js';
import { UserRole } from '../../shared/constants/index.js';

export async function registerUser(input: { email: string; name: string }) {
  const existing = await findUserByEmail(input.email);
  if (existing) throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  return createUser(input);
}

export async function listOrganizationUsers(input: {
  organizationId?: string;
  role?: string;
}) {
  const allowedRoles = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

  if (!input.role || !allowedRoles.includes(input.role as UserRole)) {
    throw new AppError(403, 'Forbidden: insufficient role', 'FORBIDDEN');
  }

  if (!input.organizationId) {
    throw new AppError(403, 'Organization context is required', 'FORBIDDEN');
  }

  return findUsersByOrganizationId(input.organizationId);
}

export async function deleteUser(id: string) {
  const user = await UserModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true });
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  return user;
}

const INVITE_EXPIRY_SECONDS = 48 * 60 * 60;
const INVITE_LINK_BASE_URL = 'https://app.navin.local/signup';

type InviteTokenPayload = {
  type: 'USER_INVITATION';
  email: string;
  role: string;
  organizationId: string;
  invitedBy: string;
};

export async function generateInvitationLink(input: {
  email: string;
  role: string;
  inviterUserId: string;
  inviterRole?: string;
  organizationId?: string;
}) {
  if (!input.organizationId) {
    throw new AppError(403, 'Organization context is required', 'FORBIDDEN');
  }

  if (!input.inviterRole) {
    throw new AppError(403, 'Forbidden: insufficient role', 'FORBIDDEN');
  }

  if (input.role === UserRole.SUPER_ADMIN) {
    throw new AppError(400, 'Cannot invite SUPER_ADMIN users', 'INVALID_ROLE');
  }

  const allowedByRole: Record<string, string[]> = {
    [UserRole.SUPER_ADMIN]: [UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER, UserRole.CUSTOMER],
    [UserRole.ADMIN]: [UserRole.MANAGER, UserRole.VIEWER, UserRole.CUSTOMER],
  };

  const allowedTargetRoles = allowedByRole[input.inviterRole] ?? [];
  if (!allowedTargetRoles.includes(input.role)) {
    throw new AppError(403, 'Forbidden: insufficient role', 'FORBIDDEN');
  }

  const existing = await findUserByEmail(input.email);
  if (existing) {
    throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  }

  const tokenPayload: InviteTokenPayload = {
    type: 'USER_INVITATION',
    email: input.email,
    role: input.role,
    organizationId: input.organizationId,
    invitedBy: input.inviterUserId,
  };

  const token = jwt.sign(tokenPayload, env.JWT_SECRET, { expiresIn: INVITE_EXPIRY_SECONDS });
  const inviteLink = `${INVITE_LINK_BASE_URL}?token=${encodeURIComponent(token)}`;

  return { token, inviteLink, expiresInSeconds: INVITE_EXPIRY_SECONDS };
}

export function verifyInvitationToken(token: string) {
  let payload: jwt.JwtPayload;

  try {
    payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw new AppError(401, 'Invalid or expired invitation token', 'UNAUTHORIZED');
  }

  if (payload.type !== 'USER_INVITATION') {
    throw new AppError(401, 'Invalid invitation token', 'UNAUTHORIZED');
  }

  if (!payload.organizationId || !payload.email || !payload.role) {
    throw new AppError(401, 'Invalid invitation token payload', 'UNAUTHORIZED');
  }

  const expiresAt = payload.exp ? new Date(payload.exp * 1000).toISOString() : null;

  return {
    email: String(payload.email),
    role: String(payload.role),
    organizationId: String(payload.organizationId),
    invitedBy: payload.invitedBy ? String(payload.invitedBy) : null,
    expiresAt,
  };
}

export async function acceptInvitation(input: { token: string; name: string; password: string }) {
  const invitation = verifyInvitationToken(input.token);

  const existing = await findUserByEmail(invitation.email);
  if (existing) {
    throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  }

  const user = await UserModel.create({
    email: invitation.email,
    name: input.name,
    passwordHash: input.password,
    role: invitation.role,
    organizationId: invitation.organizationId,
  });

  return user;
}
