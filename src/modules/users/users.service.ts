import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AppError } from '../../shared/http/errors.js';
import { createUser, findUserByEmail, findUsersByOrganizationId } from './users.repo.js';
import { UserModel } from './users.model.js';
import jwt from 'jsonwebtoken';
import { env } from '../../env.js';
import { UserRole } from '../../shared/constants/index.js';

/**
 * Creates a new user account under the caller's organization.
 * Password-less — user must complete the invitation flow to authenticate.
 */
export async function registerUser(input: {
  email: string;
  name: string;
  role?: string;
  organizationId?: string;
}) {
  if (input.role === UserRole.SUPER_ADMIN) {
    throw new AppError(400, 'Cannot create SUPER_ADMIN users via this endpoint', 'INVALID_ROLE');
  }

  const existing = await findUserByEmail(input.email);
  if (existing) throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');

  // Locked placeholder so bcrypt.compare(anything, lockedHash) always returns false
  // until the user sets a real password through the invitation flow.
  const lockedHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

  return createUser({
    email: input.email,
    name: input.name,
    passwordHash: lockedHash,
    role: input.role ?? UserRole.VIEWER,
    organizationId: input.organizationId,
  });
}

/**
 * Creates a team member under the caller's organization.
 * @param {{email: string; name: string; role?: string; callerOrganizationId: string}} input - Team member details.
 * @returns {Promise<unknown>} Created team member user document.
 * @throws {AppError} When the email is already in use.
 */
export async function createTeamMember(input: {
  email: string;
  name: string;
  role?: string;
  callerOrganizationId: string;
}) {
  const existing = await findUserByEmail(input.email);
  if (existing) throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');

  // Team members have no password until they complete the invitation flow.
  // Store a random bcrypt hash so bcrypt.compare(anything, placeholder) always
  // returns false — preventing accidental authentication.
  const lockedHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

  // Force override organizationId from caller's JWT context
  return createUser({
    email: input.email,
    name: input.name,
    passwordHash: lockedHash,
    role: input.role || UserRole.VIEWER,
    organizationId: input.callerOrganizationId, // Override with caller's org
  });
}

export interface ListOrganizationUsersResult {
  data: unknown[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Lists users within an organization for an authorized role.
 * @param {{organizationId?: string; role?: string; limit?: number; cursor?: string}} input - Organization and role scope.
 * @returns {Promise<ListOrganizationUsersResult>} Paginated organization users matching the role and org.
 * @throws {AppError} When authorization or organization context is missing.
 */
export async function listOrganizationUsers(input: {
  organizationId?: string;
  role?: string;
  limit?: number;
  cursor?: string;
}): Promise<ListOrganizationUsersResult> {
  const allowedRoles = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

  if (!input.role || !allowedRoles.includes(input.role as UserRole)) {
    throw new AppError(403, 'Forbidden: insufficient role', 'FORBIDDEN');
  }

  if (!input.organizationId) {
    throw new AppError(403, 'Organization context is required', 'FORBIDDEN');
  }

  const page = await findUsersByOrganizationId(input.organizationId, {
    limit: input.limit,
    cursor: input.cursor,
  });

  return {
    data: page.data,
    total: page.total,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

/**
 * Soft deletes a user by setting deletedAt.
 * @param {string} id - User ObjectId.
 * @returns {Promise<unknown>} The deleted user document.
 * @throws {AppError} When the user is not found.
 */
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

/**
 * Generates an invitation link and signed token for onboarding a new user.
 * @param {{email: string; role: string; inviterUserId: string; inviterRole?: string; organizationId?: string}} input - Invitation generation details.
 * @returns {Promise<{token: string; inviteLink: string; expiresInSeconds: number}>} Invitation payload.
 * @throws {AppError} When authorization fails or email is already registered.
 */
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

/**
 * Verifies an invitation JWT and returns token claims.
 * @param {string} token - Invitation JWT.
 * @returns {{email: string; role: string; organizationId: string; invitedBy: string | null; expiresAt: string | null}} Verified invitation payload.
 * @throws {AppError} When the token is invalid or expired.
 */
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

/**
 * Accepts an invitation token and creates a new user account.
 * @param {{token: string; name: string; password: string}} input - Invitation acceptance payload.
 * @returns {Promise<unknown>} Created user document.
 * @throws {AppError} When the invitation is invalid or the email is already in use.
 */
export async function acceptInvitation(input: { token: string; name: string; password: string }) {
  const invitation = verifyInvitationToken(input.token);

  const existing = await findUserByEmail(invitation.email);
  if (existing) {
    throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  }

  // Hash the raw password in the service layer — the model has no pre-save hook.
  const passwordHash = await bcrypt.hash(input.password, 10);

  const user = await UserModel.create({
    email: invitation.email,
    name: input.name,
    passwordHash,
    role: invitation.role,
    organizationId: invitation.organizationId,
  });

  return user;
}
