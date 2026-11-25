import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { config } from '../../config/index.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  if (!config.chainWebhookEncryptionKey) {
    throw new AppError(
      503,
      'CHAIN_WEBHOOK_ENCRYPTION_KEY must be configured before creating subscriptions',
      ErrorCodes.WEBHOOKS_ENCRYPTION_KEY_MISSING
    );
  }
  return Buffer.from(config.chainWebhookEncryptionKey, 'hex');
}

/**
 * Encrypts a per-subscription HMAC secret for storage at rest.
 * @throws {AppError} 503 ERR_WEBHOOKS_ENCRYPTION_KEY_MISSING when the key is unset.
 */
export function encryptChainWebhookSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(
    ':'
  );
}

/**
 * Decrypts a stored subscription signing secret.
 * @throws {AppError} 500 ERR_WEBHOOKS_INVALID_SECRET when stored data is malformed or corrupt.
 */
export function decryptChainWebhookSecret(encrypted: string): string {
  const [ivHex, tagHex, ciphertextHex, ...extra] = encrypted.split(':');
  if (
    extra.length ||
    !ivHex ||
    !tagHex ||
    !ciphertextHex ||
    !/^[0-9a-f]{24}$/i.test(ivHex) ||
    !/^[0-9a-f]{32}$/i.test(tagHex) ||
    !/^(?:[0-9a-f]{2})+$/i.test(ciphertextHex)
  ) {
    throw new AppError(
      500,
      'Stored chain webhook secret is invalid',
      ErrorCodes.WEBHOOKS_INVALID_SECRET
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AppError(
      500,
      'Stored chain webhook secret could not be decrypted',
      ErrorCodes.WEBHOOKS_INVALID_SECRET
    );
  }
}

/** Signs the exact timestamp-prefixed raw request body sent to a subscriber. */
export function createChainWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string
): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `sha256=${digest}`;
}
