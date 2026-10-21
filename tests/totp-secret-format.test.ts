/**
 * Unit tests for #702 — `totp.utils.ts` must raise a registered
 * `ERR_AUTH_2FA_*` AppError for malformed encrypted-secret payloads, from a
 * single throw site, and expose no bare `new Error(`.
 *
 * Both malformed-shape paths (wrong part count, and a wrong-length IV/auth tag)
 * previously threw an identical bare `Error('Invalid encrypted secret format')`
 * at two separate sites, so callers could not branch on the cause.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

await jest.unstable_mockModule('../src/env.js', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret-for-totp-utils',
    TOTP_ENCRYPTION_KEY: '',
  },
}));

const { decryptSecret, encryptSecret } = await import('../src/modules/auth/totp.utils.js');
const { AppError, ErrorCodes } = await import('../src/shared/http/errors.js');

const IV_BYTES = 12;
const TAG_BYTES = 16;

describe('#702 totp.utils decryptSecret error contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('round-trips a secret through encryptSecret -> decryptSecret', () => {
    const ciphertext = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(ciphertext)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('throws an AppError carrying ERR_AUTH_2FA_INVALID_SECRET_FORMAT on a wrong part count', () => {
    let caught: unknown;
    try {
      decryptSecret('only-one-part');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCodes.TOTP_INVALID_SECRET_FORMAT);
    expect((caught as AppError).message).toBe('Invalid encrypted secret format');
  });

  it('throws the same code for a non-3 part payload with trailing colons', () => {
    // 'a:b:' has 3 parts but an IV of the wrong length, so it must take the
    // byte-length rejection path and still report the same registered code.
    let caught: unknown;
    try {
      decryptSecret('a:b:');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCodes.TOTP_INVALID_SECRET_FORMAT);
  });

  it('throws the same code when the IV is the wrong byte length', () => {
    const badIv = 'aabb'; // 2 bytes, not 12
    const validTag = '00'.repeat(TAG_BYTES);
    const payload = `${badIv}:${validTag}:${'00'.repeat(8)}`;

    let caught: unknown;
    try {
      decryptSecret(payload);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCodes.TOTP_INVALID_SECRET_FORMAT);
  });

  it('throws the same code when the auth tag is the wrong byte length', () => {
    const validIv = '00'.repeat(IV_BYTES);
    const badTag = 'aabbcc'; // 3 bytes, not 16
    const payload = `${validIv}:${badTag}:${'00'.repeat(8)}`;

    let caught: unknown;
    try {
      decryptSecret(payload);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCodes.TOTP_INVALID_SECRET_FORMAT);
  });

  it('rejects an empty payload with the registered code', () => {
    let caught: unknown;
    try {
      decryptSecret('');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCodes.TOTP_INVALID_SECRET_FORMAT);
  });

  it('uses one message for every malformed-shape rejection', () => {
    // Pinned because the two former throw sites shared copy; a future split
    // would let clients branch on message text again.
    const messages = ['', 'one', 'a:b', 'a:b:c:d', 'a:b:']
      .map((payload) => {
        try {
          decryptSecret(payload);
          return null;
        } catch (error) {
          return (error as AppError).message;
        }
      })
      .filter((m): m is string => m !== null);

    expect(new Set(messages).size).toBe(1);
  });
});