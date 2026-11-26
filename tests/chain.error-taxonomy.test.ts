import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { AppError, ErrorCodes } from '../src/shared/http/errors.js';
import { NAVIN_ERRORS, NAVIN_ERROR_MAP, navinErrorToAppError } from '../src/shared/types/chain.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vendored = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/chain/navin-errors.json'), 'utf8')
) as { errors: Record<string, number> };

describe('P11-08 / #1030 — real NavinError taxonomy', () => {
  it('regression: 1/3/6/14 map to their real contract variants', () => {
    expect(navinErrorToAppError(1).details).toMatchObject({
      contractCode: 1,
      variant: 'AlreadyInitialized',
    });
    expect(navinErrorToAppError(3)).toMatchObject({
      code: ErrorCodes.CHAIN_UNAUTHORIZED,
      statusCode: 403,
      details: { contractCode: 3, variant: 'Unauthorized' },
    });
    expect(navinErrorToAppError(6)).toMatchObject({
      code: ErrorCodes.CHAIN_INVALID_HASH,
      details: { contractCode: 6, variant: 'InvalidHash' },
    });
    expect(navinErrorToAppError(14)).toMatchObject({
      code: ErrorCodes.CHAIN_INVALID_AMOUNT,
      details: { contractCode: 14, variant: 'InvalidAmount' },
    });
  });

  it('drifts only when the vendored error table changes', () => {
    expect(NAVIN_ERRORS).toEqual(vendored.errors);
  });

  it('exhaustively decodes every discriminant to a registered backend code', () => {
    const registered = new Set<string>(Object.values(ErrorCodes));
    for (const [name, code] of Object.entries(NAVIN_ERRORS)) {
      const err = navinErrorToAppError(code);
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(NAVIN_ERROR_MAP[name as keyof typeof NAVIN_ERROR_MAP].code);
      expect(err.code).toMatch(/^ERR_CHAIN_/);
      expect(registered.has(err.code)).toBe(true);
      expect(err.details).toEqual({ contractCode: code, variant: name });
    }
  });

  it('leaves gaps (12, 13, 71) and unknown codes as ERR_CHAIN_UNKNOWN with the raw code', () => {
    for (const code of [12, 13, 71, 999]) {
      expect(navinErrorToAppError(code)).toMatchObject({
        code: ErrorCodes.CHAIN_UNKNOWN,
        statusCode: 502,
        details: { contractCode: code },
      });
    }
  });
});
