/**
 * Token blocklist error-contract tests for #703.
 *
 * `blocklistKey()` previously threw a bare
 * `new Error('Invalid token identifier: expected UUID v4')`. Infra errors that
 * reach request paths must be `AppError` with a registered code so
 * `errorMiddleware` and clients can branch on `error.code`.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockSet = jest.fn<(...args: unknown[]) => unknown>();
const mockGet = jest.fn<(...args: unknown[]) => unknown>();
const mockRedisClient = {
  set: mockSet,
  get: mockGet,
};

await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
  getRedisClient: () => mockRedisClient,
}));

const { blockToken, isTokenBlocked, isValidJti } = await import(
  '../src/infra/redis/tokenBlocklist.js'
);
const { AppError, ErrorCodes } = await import('../src/shared/http/errors.js');

const VALID_JTI = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const NON_UUID = 'not-a-uuid';

describe('#703 tokenBlocklist invalid-identifier contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockResolvedValue('OK');
    mockGet.mockResolvedValue(null);
  });

  it('throws AppError with a registered code for a non-UUID jti', async () => {
    let caught: unknown;
    try {
      await blockToken(NON_UUID, 60);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCodes.TOKEN_INVALID_IDENTIFIER);
    expect((caught as AppError).code).toBe('ERR_AUTH_INVALID_TOKEN_IDENTIFIER');
    expect((caught as AppError).message).toBe('Invalid token identifier: expected UUID v4');
  });

  it('uses a 4xx status so the middleware does not report a server fault', async () => {
    let caught: unknown;
    try {
      await blockToken(NON_UUID, 60);
    } catch (error) {
      caught = error;
    }

    expect((caught as AppError).statusCode).toBeGreaterThanOrEqual(400);
    expect((caught as AppError).statusCode).toBeLessThan(500);
  });

  it('never reaches Redis with an invalid identifier', async () => {
    await blockToken(NON_UUID, 60).catch(() => undefined);

    expect(mockSet).not.toHaveBeenCalled();
  });

  it('blocklists a valid UUID v4 lowercased under the O(1) prefix', async () => {
    await blockToken(VALID_JTI.toUpperCase(), 60);

    expect(mockSet).toHaveBeenCalledWith(
      `blocklist:uuid:${VALID_JTI}`,
      '1',
      'EX',
      60
    );
  });

  it('reports blocked state for a valid UUID v4', async () => {
    mockGet.mockResolvedValue('1');
    await expect(isTokenBlocked(VALID_JTI)).resolves.toBe(true);
  });

  it('treats a malformed identifier as not blocked rather than throwing', async () => {
    // isTokenBlocked guards with isValidJti before building the key, so a
    // malformed jti must stay a soft false rather than raising.
    await expect(isTokenBlocked(NON_UUID)).resolves.toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('validates UUID v4 shape via isValidJti', () => {
    expect(isValidJti(VALID_JTI)).toBe(true);
    expect(isValidJti(NON_UUID)).toBe(false);
    // v1 UUID: the version nibble is 1, not 4.
    expect(isValidJti('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false);
  });
});