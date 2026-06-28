import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AppError } from '../../shared/http/errors.js';
import { env } from '../../env.js';
import { UserModel, OrganizationModel, UserRole } from '../users/users.model.js';
import type { OrganizationType } from '../../shared/types/user.js';
import { blockToken } from '../../infra/redis/tokenBlocklist.js';
import type { SignupInput, LoginInput } from './auth.validation.js';
import { logger } from '../../shared/logger/logger.js';

export interface TokenPayload {
  userId: string;
  role: string;
  organizationId?: string;
  organizationType?: OrganizationType;
  jti: string;
}

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function generateToken(payload: Omit<TokenPayload, 'jti'>): string {
  const jti = randomUUID();
  return jwt.sign({ ...payload, jti }, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

/**
 * Determines the appropriate role for a new user based on email domain.
 * Admin domains get ADMIN role, all others default to VIEWER.
 */
function determineUserRole(email: string): UserRole {
  const adminDomains = ['navin.io', 'navin-admin.com', 'admin.navin.io'];
  const emailDomain = email.split('@')[1]?.toLowerCase();

  if (emailDomain && adminDomains.includes(emailDomain)) {
    return UserRole.ADMIN;
  }

  return UserRole.VIEWER;
}

/**
 * Registers a new user and returns an auth token.
 * @param {SignupInput} input - User signup input payload.
 * @returns {Promise<{user: {id: string; email: string; name: string; role: string}; token: string}>} The created user and JWT token.
 * @throws {AppError} When the email is already in use.
 */
export async function signup(input: SignupInput) {
  const existing = await UserModel.findOne({ email: input.email });
  if (existing) {
    throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  }

  const hashedPassword = await bcrypt.hash(input.password, 10);
  const assignedRole = input.role ? input.role : determineUserRole(input.email);

  const user = await UserModel.create({
    email: input.email,
    name: input.name,
    passwordHash: hashedPassword,
    role: assignedRole,
    organizationId: input.organizationId,
  });

  let organizationType: OrganizationType | undefined;
  if (user.organizationId) {
    const organization = await OrganizationModel.findById(user.organizationId);
    organizationType = organization?.type;
  }

  const token = generateToken({
    userId: user._id.toString(),
    role: user.role as string,
    organizationId: user.organizationId?.toString(),
    organizationType,
  });

  return {
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role as string,
    },
    token,
  };
}

/**
 * Authenticates a user and returns a JWT.
 * @param {LoginInput} input - User login credentials.
 * @returns {Promise<{user: {id: string; email: string; name: string; role: string}; token: string}>} Authenticated user data and token.
 * @throws {AppError} When credentials are invalid.
 */
export async function login(input: LoginInput) {
  const user = await UserModel.findOne({ email: input.email });
  if (!user) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const isValidPassword = await bcrypt.compare(input.password, user.passwordHash as string);
  if (!isValidPassword) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  let organizationType: OrganizationType | undefined;
  if (user.organizationId) {
    const organization = await OrganizationModel.findById(user.organizationId);
    organizationType = organization?.type;
  }

  const token = generateToken({
    userId: user._id.toString(),
    role: user.role as string,
    organizationId: user.organizationId?.toString(),
    organizationType,
  });

  return {
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    token,
  };
}

/**
 * Verifies a JWT and returns its payload.
 * @param {string} token - JWT string to verify.
 * @returns {TokenPayload} Verified token payload.
 */
export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

/**
 * Revokes a JWT by adding its jti to the blocklist.
 * @param {string} token - JWT to revoke.
 * @returns {Promise<void>} Resolves once the token is blocked.
 */
export async function logout(token: string): Promise<void> {
  let payload: TokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    // Token already invalid — nothing to revoke
    return;
  }

  const exp = (payload as TokenPayload & { exp?: number }).exp;
  const ttl = exp ? exp - Math.floor(Date.now() / 1000) : TOKEN_TTL_SECONDS;

  if (ttl > 0 && payload.jti) {
    await blockToken(payload.jti, ttl);
  }
}

const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Generates a password-reset token and logs it (no email provider configured).
 * Always returns success to prevent email enumeration.
 * @param {string} email - Target email address.
 */
export async function forgotPassword(email: string): Promise<void> {
  const user = await UserModel.findOne({ email });
  if (!user) {
    // Prevent enumeration — always succeed silently
    return;
  }

  const jti = randomUUID();
  const resetToken = jwt.sign(
    { userId: user._id.toString(), type: 'PASSWORD_RESET', jti },
    env.JWT_SECRET,
    { expiresIn: RESET_TOKEN_TTL_SECONDS }
  );

  // In production this token would be sent via email.
  logger.info({ userId: user._id.toString(), resetToken }, 'Password reset token generated');
}

/**
 * Validates a reset token and updates the user's password, revoking all existing sessions.
 * @param {string} token - Password reset JWT.
 * @param {string} newPassword - New plaintext password (min 8 chars).
 * @throws {AppError} When token is invalid, expired, or wrong type.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  let payload: { userId: string; type: string; jti: string; exp?: number };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as typeof payload;
  } catch {
    throw new AppError(400, 'Invalid or expired reset token', 'ERR_AUTH_INVALID_RESET_TOKEN');
  }

  if (payload.type !== 'PASSWORD_RESET') {
    throw new AppError(400, 'Invalid or expired reset token', 'ERR_AUTH_INVALID_RESET_TOKEN');
  }

  const user = await UserModel.findById(payload.userId);
  if (!user) {
    throw new AppError(400, 'Invalid or expired reset token', 'ERR_AUTH_INVALID_RESET_TOKEN');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  (user as { passwordHash: string }).passwordHash = passwordHash;
  await (user as unknown as { save: () => Promise<void> }).save();

  // Revoke the reset token itself
  if (payload.jti) {
    const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : RESET_TOKEN_TTL_SECONDS;
    if (ttl > 0) await blockToken(payload.jti, ttl);
  }
}
