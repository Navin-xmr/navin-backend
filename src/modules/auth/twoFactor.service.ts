import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { UserModel } from '../users/users.model.js';

/** Number of backup codes generated per request */
const BACKUP_CODE_COUNT = 10;
/** bcrypt cost factor for hashing backup codes */
const BACKUP_CODE_HASH_ROUNDS = 10;
/** Length of each raw backup code in bytes (renders as 10 hex chars) */
const BACKUP_CODE_BYTES = 5;

/**
 * Generates an array of cryptographically random backup codes.
 * Returns both the plaintext codes (to show to the user once) and
 * their bcrypt hashes (for storage).
 */
async function generateBackupCodes(): Promise<{ plain: string[]; hashed: string[] }> {
  const plain: string[] = [];
  const hashed: string[] = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = randomBytes(BACKUP_CODE_BYTES).toString('hex'); // 10 hex chars
    const hash = await bcrypt.hash(code, BACKUP_CODE_HASH_ROUNDS);
    plain.push(code);
    hashed.push(hash);
  }

  return { plain, hashed };
}

/**
 * POST /api/auth/2fa/setup (issue #7 prerequisite)
 *
 * Generates a TOTP secret for the authenticated user and returns the
 * otpauth:// URI for QR-code rendering. Does NOT enable 2FA yet —
 * the client must call verify to confirm a working code first.
 *
 * @param userId - The authenticated user's ID from the JWT payload.
 * @returns `{ otpauthUrl, secret }` — secret exposed once for manual entry.
 * @throws {AppError} 404 when the user cannot be found.
 * @throws {AppError} 409 when 2FA is already enabled.
 */
export async function setup2fa(userId: string): Promise<{ otpauthUrl: string; secret: string }> {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }

  if (user.totpEnabled) {
    throw new AppError(409, '2FA is already enabled', ErrorCodes.TOTP_ALREADY_ENABLED);
  }

  const secret = generateSecret();

  // Store the pending secret (not yet active — totpEnabled stays false)
  await UserModel.findByIdAndUpdate(userId, { totpSecret: secret });

  const otpauthUrl = generateURI({ label: user.email as string, issuer: 'Navin', secret });

  return { otpauthUrl, secret };
}

/**
 * POST /api/auth/2fa/verify
 *
 * Validates the first TOTP code against the stored pending secret, enables
 * 2FA on the account, and generates 10 single-use backup codes.
 * Backup codes are hashed before storage; the plaintext codes are returned
 * exactly once.
 *
 * @param userId - The authenticated user's ID.
 * @param code   - 6-digit TOTP code from the authenticator app.
 * @returns `{ backupCodes }` — 10 plaintext backup codes (shown once only).
 * @throws {AppError} 404 when user not found.
 * @throws {AppError} 400 when no secret has been set up yet.
 * @throws {AppError} 409 when 2FA is already enabled.
 * @throws {AppError} 400 when the TOTP code is invalid.
 */
export async function verify2fa(userId: string, code: string): Promise<{ backupCodes: string[] }> {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }

  if (!user.totpSecret) {
    throw new AppError(
      400,
      '2FA setup not initiated. Call POST /api/auth/2fa/setup first.',
      ErrorCodes.TOTP_NOT_SETUP
    );
  }

  if (user.totpEnabled) {
    throw new AppError(409, '2FA is already enabled', ErrorCodes.TOTP_ALREADY_ENABLED);
  }

  const verifyResult = verifySync({ token: code, secret: user.totpSecret as string });
  if (!verifyResult.valid) {
    throw new AppError(400, 'Invalid TOTP code', ErrorCodes.TOTP_INVALID_CODE);
  }

  const { plain, hashed } = await generateBackupCodes();

  await UserModel.findByIdAndUpdate(userId, {
    totpEnabled: true,
    totpBackupCodes: hashed,
  });

  return { backupCodes: plain };
}

/**
 * DELETE /api/auth/2fa
 *
 * Disables 2FA on the account after verifying the user's current password.
 * Clears `totpSecret`, `totpEnabled`, and `totpBackupCodes`.
 *
 * @param userId   - The authenticated user's ID.
 * @param password - Current account password (plaintext).
 * @throws {AppError} 404 when user not found.
 * @throws {AppError} 400 when 2FA is not currently enabled.
 * @throws {AppError} 401 when the password is incorrect.
 */
export async function disable2fa(userId: string, password: string): Promise<void> {
  const user = await UserModel.findById(userId).select('+passwordHash');
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }

  if (!user.totpEnabled) {
    throw new AppError(400, '2FA is not enabled on this account', ErrorCodes.TOTP_NOT_ENABLED);
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash as string);
  if (!passwordMatch) {
    throw new AppError(401, 'Incorrect password', ErrorCodes.UNAUTHORIZED);
  }

  await UserModel.findByIdAndUpdate(userId, {
    totpEnabled: false,
    totpSecret: null,
    totpBackupCodes: [],
  });
}

/**
 * POST /api/auth/2fa/backup-codes/regenerate
 *
 * Invalidates all existing backup codes and issues 10 fresh ones.
 * Requires 2FA to be enabled (you can't regenerate codes without having
 * 2FA set up).
 *
 * @param userId - The authenticated user's ID.
 * @returns `{ backupCodes }` — 10 new plaintext backup codes.
 * @throws {AppError} 404 when user not found.
 * @throws {AppError} 400 when 2FA is not enabled.
 */
export async function regenerateBackupCodes(userId: string): Promise<{ backupCodes: string[] }> {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }

  if (!user.totpEnabled) {
    throw new AppError(400, '2FA is not enabled on this account', ErrorCodes.TOTP_NOT_ENABLED);
  }

  const { plain, hashed } = await generateBackupCodes();

  await UserModel.findByIdAndUpdate(userId, { totpBackupCodes: hashed });

  return { backupCodes: plain };
}

/**
 * Verifies a backup code for a user (used during 2FA login when the user
 * has lost access to their authenticator app).
 *
 * Each code is single-use: it is removed from the stored list on success.
 *
 * @param userId - The authenticated user's ID.
 * @param code   - 10-hex-char backup code.
 * @returns `true` on success.
 * @throws {AppError} 401 when the backup code does not match any stored hash.
 */
export async function consumeBackupCode(userId: string, code: string): Promise<true> {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(401, 'Invalid backup code', ErrorCodes.TOTP_INVALID_BACKUP_CODE);
  }

  const codes = user.totpBackupCodes as string[];
  let matchIndex = -1;

  for (let i = 0; i < codes.length; i++) {
    if (await bcrypt.compare(code, codes[i])) {
      matchIndex = i;
      break;
    }
  }

  if (matchIndex === -1) {
    throw new AppError(401, 'Invalid backup code', ErrorCodes.TOTP_INVALID_BACKUP_CODE);
  }

  // Remove the used code (single-use enforcement)
  const updatedCodes = [...codes];
  updatedCodes.splice(matchIndex, 1);
  await UserModel.findByIdAndUpdate(userId, { totpBackupCodes: updatedCodes });

  return true;
}
