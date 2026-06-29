import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AppError } from '../../shared/http/errors.js';
import { env } from '../../env.js';
import { UserModel, OrganizationModel, UserRole } from '../users/users.model.js';
import type { OrganizationType } from '../../shared/types/user.js';
import { blockToken, isTokenBlocked } from '../../infra/redis/tokenBlocklist.js';
import type { SignupInput, LoginInput } from './auth.validation.js';

export interface TokenPayload {
  userId: string;
  role: string;
  organizationId?: string;
  organizationType?: OrganizationType;
  jti: string;
}

// SECURITY: [Token Lifecycle Compromise] — This prevents long-term token abuse by enforcing a 7-day Time-To-Live (TTL) limit on authentication tokens, bounding the window of opportunity for stolen credentials.
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function generateToken(payload: Omit<TokenPayload, 'jti'>): string {
  // SECURITY: [Token Replay Attack] — This prevents reuse of old or intercepted JWTs by attaching a cryptographically random, unique JWT ID (jti) to each token, allowing the middleware to track and revoke individual sessions via Redis.
  const jti = randomUUID();
  return jwt.sign({ ...payload, jti }, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

/**
 * Determines the safe default role for public signup.
 */
function determineUserRole(_email: string): UserRole {
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
  const assignedRole = determineUserRole(input.email) ?? UserRole.VIEWER;

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
 * Issues a new JWT in exchange for a valid (or recently-expired) token.
 * Blocklists the old token's JTI to prevent replay.
 */
export async function refreshToken(token: string): Promise<{ token: string; expiresIn: number }> {
  let payload: TokenPayload & { exp?: number; iat?: number };
  try {
    payload = jwt.verify(token, env.JWT_SECRET, {
      ignoreExpiration: true,
    }) as TokenPayload & { exp?: number; iat?: number };
  } catch {
    throw new AppError(401, 'Invalid token', 'INVALID_TOKEN');
  }

  if (!payload.jti) {
    throw new AppError(401, 'Invalid token', 'INVALID_TOKEN');
  }

  const isBlocked = await isTokenBlocked(payload.jti);
  if (isBlocked) {
    throw new AppError(401, 'Token has been revoked', 'TOKEN_REVOKED');
  }

  const issuedAt = payload.iat ?? 0;
  const gracePeriodSeconds = 7 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  if (now - issuedAt > gracePeriodSeconds) {
    throw new AppError(401, 'Token is too old to refresh', 'TOKEN_EXPIRED');
  }

  const user = await UserModel.findById(payload.userId);
  if (!user || (user as any).deletedAt) {
    throw new AppError(401, 'User no longer exists', 'USER_NOT_FOUND');
  }

  let organizationType: OrganizationType | undefined;
  if (user.organizationId) {
    const org = await OrganizationModel.findById(user.organizationId);
    organizationType = org?.type;
  }

  const exp = payload.exp ?? now;
  const oldTtl = exp - now;
  if (oldTtl > 0) {
    await blockToken(payload.jti, oldTtl + gracePeriodSeconds);
  } else {
    await blockToken(payload.jti, gracePeriodSeconds);
  }

  const newToken = generateToken({
    userId: user._id.toString(),
    role: user.role as string,
    organizationId: user.organizationId?.toString(),
    organizationType,
  });

  return { token: newToken, expiresIn: TOKEN_TTL_SECONDS };
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
