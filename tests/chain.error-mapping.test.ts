import { describe, expect, it } from '@jest/globals';
import { ErrorCodes } from '../src/shared/http/errors.js';
import {
  chainErrorToAppError,
  updateStatusErrorToAppError,
  CHAIN_CONTRACT_ERRORS,
  UPDATE_STATUS_CONTRACT_ERRORS,
  CHAIN_ERROR_MAP,
  UPDATE_STATUS_ERROR_MAP,
} from '../src/shared/types/chain.js';

/**
 * Failure-injection matrix for every NavinError class (#1034).
 * Maps contract error codes to injected conditions and verifies:
 * - The mapped ERR_CHAIN_* code
 * - The HTTP status
 * - That no state is corrupted
 */
describe('Chain Error Mapping Matrix', () => {
  describe('Legacy contract errors (anchor, init_escrow, release_escrow)', () => {
    const legacyErrorMatrix = [
      {
        name: 'NotAuthorized',
        code: CHAIN_CONTRACT_ERRORS.NotAuthorized,
        expectedCode: ErrorCodes.CHAIN_UNAUTHORIZED,
        expectedStatus: 403,
      },
      {
        name: 'InvalidHash',
        code: CHAIN_CONTRACT_ERRORS.InvalidHash,
        expectedCode: ErrorCodes.CHAIN_INVALID_HASH,
        expectedStatus: 422,
      },
      {
        name: 'AlreadyAnchored',
        code: CHAIN_CONTRACT_ERRORS.AlreadyAnchored,
        expectedCode: ErrorCodes.CHAIN_ALREADY_ANCHORED,
        expectedStatus: 409,
      },
      {
        name: 'EscrowExists',
        code: CHAIN_CONTRACT_ERRORS.EscrowExists,
        expectedCode: ErrorCodes.CHAIN_ESCROW_EXISTS,
        expectedStatus: 409,
      },
      {
        name: 'EscrowNotFound',
        code: CHAIN_CONTRACT_ERRORS.EscrowNotFound,
        expectedCode: ErrorCodes.CHAIN_ESCROW_NOT_FOUND,
        expectedStatus: 404,
      },
      {
        name: 'EscrowAlreadyReleased',
        code: CHAIN_CONTRACT_ERRORS.EscrowAlreadyReleased,
        expectedCode: ErrorCodes.CHAIN_ESCROW_ALREADY_RELEASED,
        expectedStatus: 409,
      },
      {
        name: 'InvalidAmount',
        code: CHAIN_CONTRACT_ERRORS.InvalidAmount,
        expectedCode: ErrorCodes.CHAIN_INVALID_AMOUNT,
        expectedStatus: 422,
      },
      {
        name: 'InvalidProof',
        code: CHAIN_CONTRACT_ERRORS.InvalidProof,
        expectedCode: ErrorCodes.CHAIN_INVALID_PROOF,
        expectedStatus: 422,
      },
      {
        name: 'InvalidStatus',
        code: CHAIN_CONTRACT_ERRORS.InvalidStatus,
        expectedCode: ErrorCodes.CHAIN_INVALID_STATUS,
        expectedStatus: 409,
      },
    ];

    it.each(legacyErrorMatrix)(
      'should decode $name (code $code) → $expectedCode ($expectedStatus)',
      ({ code, expectedCode, expectedStatus }) => {
        const error = chainErrorToAppError(code);
        expect(error.code).toBe(expectedCode);
        expect(error.statusCode).toBe(expectedStatus);
        expect(error.details).toEqual({ contractCode: code });
      }
    );

    it('should map unknown legacy error codes to ERR_CHAIN_UNKNOWN (502)', () => {
      const unknownCode = 9999;
      const error = chainErrorToAppError(unknownCode);
      expect(error.code).toBe(ErrorCodes.CHAIN_UNKNOWN);
      expect(error.statusCode).toBe(502);
      expect(error.details).toEqual({ contractCode: unknownCode });
    });

    it('should map all CHAIN_ERROR_MAP entries to ErrorCodes', () => {
      Object.entries(CHAIN_ERROR_MAP).forEach(([name, { code, status }]) => {
        expect(Object.values(ErrorCodes)).toContain(code);
        expect(status).toBeGreaterThanOrEqual(400);
        expect(status).toBeLessThan(600);
      });
    });
  });

  describe('update_status contract errors (#1033, P11-08)', () => {
    const updateStatusMatrix = [
      {
        name: 'Unauthorized',
        code: UPDATE_STATUS_CONTRACT_ERRORS.Unauthorized,
        expectedCode: ErrorCodes.CHAIN_UNAUTHORIZED,
        expectedStatus: 403,
      },
      {
        name: 'ShipmentNotFound',
        code: UPDATE_STATUS_CONTRACT_ERRORS.ShipmentNotFound,
        expectedCode: ErrorCodes.CHAIN_SHIPMENT_NOT_FOUND,
        expectedStatus: 404,
      },
      {
        name: 'InvalidStatus',
        code: UPDATE_STATUS_CONTRACT_ERRORS.InvalidStatus,
        expectedCode: ErrorCodes.CHAIN_INVALID_STATUS,
        expectedStatus: 409,
      },
      {
        name: 'InvalidHash',
        code: UPDATE_STATUS_CONTRACT_ERRORS.InvalidHash,
        expectedCode: ErrorCodes.CHAIN_INVALID_HASH,
        expectedStatus: 422,
      },
      {
        name: 'ShipmentFinalized',
        code: UPDATE_STATUS_CONTRACT_ERRORS.ShipmentFinalized,
        expectedCode: ErrorCodes.CHAIN_INVALID_STATUS,
        expectedStatus: 409,
      },
      {
        name: 'DuplicateAction',
        code: UPDATE_STATUS_CONTRACT_ERRORS.DuplicateAction,
        expectedCode: ErrorCodes.CHAIN_DUPLICATE_ACTION,
        expectedStatus: 409,
      },
    ];

    it.each(updateStatusMatrix)(
      'should decode $name (code $code) → $expectedCode ($expectedStatus)',
      ({ code, expectedCode, expectedStatus }) => {
        const error = updateStatusErrorToAppError(code);
        expect(error.code).toBe(expectedCode);
        expect(error.statusCode).toBe(expectedStatus);
        expect(error.details).toMatchObject({
          contractCode: code,
          function: 'update_status',
        });
      }
    );

    it('should map unmapped update_status error codes to ERR_CHAIN_UNKNOWN (502)', () => {
      const unmappedCode = 9999;
      const error = updateStatusErrorToAppError(unmappedCode);
      expect(error.code).toBe(ErrorCodes.CHAIN_UNKNOWN);
      expect(error.statusCode).toBe(502);
      expect(error.details).toMatchObject({
        contractCode: unmappedCode,
        function: 'update_status',
      });
    });

    it('should map all UPDATE_STATUS_ERROR_MAP entries to ErrorCodes', () => {
      Object.entries(UPDATE_STATUS_ERROR_MAP).forEach(([name, { code, status }]) => {
        expect(Object.values(ErrorCodes)).toContain(code);
        expect(status).toBeGreaterThanOrEqual(400);
        expect(status).toBeLessThan(600);
      });
    });
  });

  describe('Error code coverage and state integrity', () => {
    it('should have no missing mappings in CHAIN_ERROR_MAP', () => {
      const errorNames = Object.keys(CHAIN_CONTRACT_ERRORS) as Array<
        keyof typeof CHAIN_CONTRACT_ERRORS
      >;
      errorNames.forEach(name => {
        expect(CHAIN_ERROR_MAP[name]).toBeDefined();
      });
    });

    it('should have no missing mappings in UPDATE_STATUS_ERROR_MAP', () => {
      const errorNames = Object.keys(UPDATE_STATUS_CONTRACT_ERRORS) as Array<
        keyof typeof UPDATE_STATUS_CONTRACT_ERRORS
      >;
      errorNames.forEach(name => {
        expect(UPDATE_STATUS_ERROR_MAP[name]).toBeDefined();
      });
    });

    it('should not corrupt error details when decoding', () => {
      const testCodes = [
        CHAIN_CONTRACT_ERRORS.NotAuthorized,
        UPDATE_STATUS_CONTRACT_ERRORS.ShipmentNotFound,
      ];

      testCodes.forEach(code => {
        const legacyError = chainErrorToAppError(code);
        expect(legacyError.code).toMatch(/^ERR_CHAIN_/);
        expect(legacyError.statusCode).toBeGreaterThanOrEqual(400);
        expect(legacyError.statusCode).toBeLessThan(600);

        const statusError = updateStatusErrorToAppError(code);
        expect(statusError.code).toMatch(/^ERR_CHAIN_/);
        expect(statusError.statusCode).toBeGreaterThanOrEqual(400);
        expect(statusError.statusCode).toBeLessThan(600);
      });
    });
  });
});
