/**
 * TOTP secret encryption / decryption helpers.
 *
 * Uses AES-256-GCM (Node built-in `crypto`) to encrypt TOTP secrets before
 * storing them in MongoDB, so a database dump never exposes raw base32 secrets.
 *
 * Key material comes from TOTP_ENCRYPTION_KEY (64 hex chars = 32 bytes).
 * When the env var is absent we fall back to a deterministic key derived from
 * JWT_SECRET so the feature stays functional in development without forcing
 * everyone to set a new env var.  Production deployments SHOULD set an
 * independent TOTP_ENCRYPTION_KEY.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { env } from '../../env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16;

/** Derive a 32-byte key from the configured hex string or fall back to JWT_SECRET hash. */
function getEncryptionKey(): Buffer {
  if (env.TOTP_ENCRYPTION_KEY) {
    return Buffer.from(env.TOTP_ENCRYPTION_KEY, 'hex');
  }
  // Fallback: SHA-256 of JWT_SECRET so development environments work out-of-the-box.
  return createHash('sha256').update(env.JWT_SECRET).digest();
}

/**
 * Encrypts a plaintext TOTP secret string.
 * @returns Colon-delimited hex string: `<iv>:<authTag>:<ciphertext>`
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

/**
 * Decrypts a TOTP secret previously encrypted by `encryptSecret`.
 * @throws {Error} When the payload is malformed or authentication fails (tampered data).
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }

  const [ivHex, tagHex, ctHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctHex, 'hex');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Invalid encrypted secret format');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
