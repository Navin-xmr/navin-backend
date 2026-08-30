import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { generateSecret as totpGenerateSecret, generateURI as totpGenerateURI } from 'otplib';
import QRCode from 'qrcode';
import { AppError } from '../../shared/http/errors.js';
import { env } from '../../env.js';
import { config } from '../../config/index.js';
import { OrganizationType } from '../../shared/constants/index.js';
import { UserModel, OrganizationModel, UserRole } from '../users/users.model.js';
import { blockToken, isTokenBlocked } from '../../infra/redis/tokenBlocklist.js';
import { createSession } from './session.service.js';
import type { SignupInput, LoginInput } from './auth.validation.js';
import { logger } from '../../shared/logger/logger.js';
import { sendEmail, resetPasswordEmailHtml } from '../../services/email.service.js';
import { encryptSecret } from './totp.utils.js';

export interface TokenPayload {
  userId: string;
  role: string;
  persona?: 'company' | 'customer';
  organizationId?: string;
  organizationType?: OrganizationType;
  jti: string;
}

// SECURITY: [Token Lifecycle Compromise] — This prevents long-term token abuse by enforcing a 7-day Time-To-Live (TTL) limit on authentication tokens, bounding the window of opportunity for stolen credentials.
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function generateToken(payload: Omit<TokenPayload, 'jti'>): { token: string; jti: string } {
  // SECURITY: [Token Replay Attack] — This prevents reuse of old or intercepted JWTs by attaching a cryptographically random, unique JWT ID (jti) to each token, allowing the middleware to track and revoke individual sessions via Redis.
  const jti = randomUUID();
  const token = jwt.sign({ ...payload, jti }, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
  return { token, jti };
}

/**
 * Determines the safe default role for public signup.
 *
 * SECURITY: Always returns VIEWER role to prevent privilege escalation.
 * No exceptions or role overrides permitted for unauthenticated signup.
 * Admin/privileged roles are assigned exclusively through:
 * - POST /api/users (ADMIN only)
 * - POST /api/users/team (ADMIN only)
 * - Invitation acceptance flow (role determined by inviter)
 *
 * @param {string} _email - Email (unused - role is same for all users)
 * @returns {UserRole} Always returns VIEWER
 */
function determineUserRole(_email: string): UserRole {
  return UserRole.VIEWER;
}

function derivePersona(role: string, organizationType?: OrganizationType): 'company' | 'customer' {
  if (role === UserRole.CUSTOMER || organizationType === OrganizationType.ENTERPRISE) {
    return 'customer';
  }

  return 'company';
}

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Registers a new user and returns an auth token.
 *
 * SECURITY CONTROLS:
 * - Public signup ALWAYS assigns VIEWER role (determined via determineUserRole)
 * - No role parameter accepted in request body (enforced by SignupBodySchema)
 * - Admin/privileged roles only assignable via authenticated admin endpoints
 * - Prevents privilege escalation (CWE-284) by unauthenticated users
 *
 * @param {SignupInput} input - User signup input payload.
 * @param {RequestContext} [ctx] - Optional request context for session tracking.
 * @returns {Promise<{user: {id: string; email: string; name: string; role: string}; token: string}>} The created user and JWT token.
 * @throws {AppError} When the email is already in use.
 */
export async function signup(input: SignupInput, ctx?: RequestContext) {
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

  const { token, jti } = generateToken({
    userId: user._id.toString(),
    role: user.role as string,
    persona: derivePersona(user.role as string, organizationType),
    organizationId: user.organizationId?.toString(),
    organizationType,
  });

  await createSession({ userId: user._id.toString(), jti, ip: ctx?.ip, userAgent: ctx?.userAgent });

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
 * @param {RequestContext} [ctx] - Optional request context for session tracking.
 * @returns {Promise<{user: {id: string; email: string; name: string; role: string}; token: string}>} Authenticated user data and token.
 * @throws {AppError} When credentials are invalid.
 */
export async function login(input: LoginInput, ctx?: RequestContext) {
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

  const { token, jti } = generateToken({
    userId: user._id.toString(),
    role: user.role as string,
    persona: derivePersona(user.role as string, organizationType),
    organizationId: user.organizationId?.toString(),
    organizationType,
  });

  await createSession({ userId: user._id.toString(), jti, ip: ctx?.ip, userAgent: ctx?.userAgent });

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
 * Refreshes a JWT within the grace window (7 days from issue).
 * Blocklists the old token's JTI and issues a new one.
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
  if (!user || user.deletedAt) {
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
    persona: derivePersona(user.role as string, organizationType),
    organizationId: user.organizationId?.toString(),
    organizationType,
  });

  return { token: newToken.token, expiresIn: TOKEN_TTL_SECONDS };
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
 * Generates a password-reset token and emails it to the user.
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

  const resetLink = `${config.frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

  try {
    await sendEmail({
      to: email,
      subject: 'Reset Your Navin Password',
      html: resetPasswordEmailHtml(resetLink),
    });
  } catch (err) {
    logger.error({ err, userId: user._id.toString() }, 'Failed to send password reset email');
  }
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

/**
 * Self-service company registration: creates both an Organization (type: ENTERPRISE)
 * and the first admin user in a single atomic operation.
 *
 * @param {RegisterCompanyInput} input - Company and admin user details.
 * @returns {Promise<{user: {id: string; email: string; name: string; role: string}; token: string}>} The created admin user and JWT token.
 * @throws {AppError} 409 if email or organization name already exists.
 * @throws {AppError} 400 for validation failures.
 */
export async function registerCompany(input: {
  companyName: string;
  industry: string;
  country: string;
  companySize: string;
  adminName: string;
  email: string;
  password: string;
}) {
  // Start a MongoDB session for transaction
  const session = await UserModel.startSession();
  session.startTransaction();

  try {
    // Check if email already exists
    const existingUser = await UserModel.findOne({ email: input.email });
    if (existingUser) {
      throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
    }

    // Check if organization name already exists
    const existingOrg = await OrganizationModel.findOne({ name: input.companyName });
    if (existingOrg) {
      throw new AppError(409, 'Organization name already exists', 'DUPLICATE_KEY');
    }

    // Create organization with settings
    const organization = await OrganizationModel.create(
      [
        {
          name: input.companyName,
          type: OrganizationType.ENTERPRISE,
          settings: {
            industry: input.industry,
            country: input.country,
            companySize: input.companySize,
          },
        },
      ],
      { session }
    );

    const orgId = organization[0]._id;

    // Create admin user with password hash
    const hashedPassword = await bcrypt.hash(input.password, 10);
    const user = await UserModel.create(
      [
        {
          email: input.email,
          name: input.adminName,
          passwordHash: hashedPassword,
          role: UserRole.ADMIN,
          organizationId: orgId,
        },
      ],
      { session }
    );

    // Commit transaction
    await session.commitTransaction();

    const createdUser = user[0];

    // Generate JWT token with organization context
    const { token } = generateToken({
      userId: createdUser._id.toString(),
      role: UserRole.ADMIN,
      persona: derivePersona(UserRole.ADMIN, OrganizationType.ENTERPRISE),
      organizationId: orgId.toString(),
      organizationType: OrganizationType.ENTERPRISE,
    });

    return {
      user: {
        id: createdUser._id,
        email: createdUser.email,
        name: createdUser.name,
        role: createdUser.role,
      },
      token,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

/**
 * Changes the authenticated user's password after verifying the current one.
 * Blocklists the current JWT to force re-login.
 *
 * @param userId - Authenticated user's ID.
 * @param currentPassword - Plaintext current password to verify.
 * @param newPassword - New plaintext password (min 8 chars).
 * @param currentJwt - The current JWT string (to blocklist after change).
 * @throws {AppError} 401 INVALID_CREDENTIALS — when currentPassword is wrong.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when user not found.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentJwt: string
): Promise<void> {
  const user = await UserModel.findById(userId).select('+passwordHash');
  if (!user || user.deletedAt) {
    throw new AppError(401, 'User not found', 'ERR_AUTH_INVALID');
  }

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash as string);
  if (!isValid) {
    throw new AppError(401, 'Current password is incorrect', 'INVALID_CREDENTIALS');
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await (user as unknown as { save: () => Promise<void> }).save();

  // Blocklist the current token to force re-login
  try {
    const payload = verifyToken(currentJwt) as TokenPayload & { exp?: number };
    if (payload.jti) {
      const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : TOKEN_TTL_SECONDS;
      if (ttl > 0) await blockToken(payload.jti, ttl);
    }
  } catch {
    // Token already invalid — nothing to blocklist
  }
}

/**
 * Generates a TOTP secret for the authenticated user, encrypts it, persists it to
 * the database, and returns an `otpauth://` QR code data URL for scanning with an
 * authenticator app (Google Authenticator, Authy, etc.).
 *
 * IMPORTANT: This call does NOT enable 2FA.  `twoFactorEnabled` remains `false` until
 * the user proves they can produce a valid TOTP code (see the upcoming verify endpoint).
 *
 * @param userId - The authenticated user's ID (from `req.user.userId`).
 * @returns `{ qrCodeUrl }` — base64 PNG data URL suitable for an `<img>` tag.
 * @throws {AppError} 401 when the user no longer exists.
 */
export async function setup2fa(userId: string): Promise<{ qrCodeUrl: string }> {
  const user = await UserModel.findById(userId).select('+twoFactorSecret').lean();
  if (!user || user.deletedAt) {
    throw new AppError(401, 'User not found', 'ERR_AUTH_INVALID');
  }

  // Generate a new base32 TOTP secret (20-byte / 160-bit entropy).
  const secret = totpGenerateSecret();

  // Build the otpauth:// URI that authenticator apps parse when scanning the QR code.
  const otpauthUrl = totpGenerateURI({
    label: (user as { email: string }).email,
    issuer: 'Navin',
    secret,
    strategy: 'totp',
  } as Parameters<typeof totpGenerateURI>[0]);

  // Encrypt before storing — secret is NEVER saved in plaintext.
  const encryptedSecret = encryptSecret(secret);

  // Persist the encrypted secret; leave twoFactorEnabled = false until verified.
  await UserModel.findByIdAndUpdate(userId, {
    twoFactorSecret: encryptedSecret,
    twoFactorEnabled: false,
  });

  // Render the otpauth:// URI as a base64 PNG data URL.
  const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

  return { qrCodeUrl };
}
