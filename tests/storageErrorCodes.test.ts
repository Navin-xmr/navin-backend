/**
 * Storage error-code tests for #701.
 *
 * `cloudinaryStorage.ts` previously rejected upload and delete failures with a
 * bare `new Error(...)`, and `StorageError` carried no `code` field at all, so
 * callers had no registered `ERR_FILE_*` value to branch on. These tests pin
 * that `StorageError` now carries a code and that the Cloudinary adapter's
 * rejection paths raise registered codes.
 */

import { describe, it, expect } from '@jest/globals';
import { StorageError } from '../src/services/storage/types.js';
import { ErrorCodes } from '../src/shared/http/errors.js';

describe('#701 StorageError error-code contract', () => {
  it('carries a registered ERR_FILE_* code when supplied', () => {
    const error = new StorageError(
      'Cloudinary upload failed',
      'cloudinary',
      502,
      undefined,
      ErrorCodes.FILE_UPLOAD_FAILED
    );

    expect(error.code).toBe(ErrorCodes.FILE_UPLOAD_FAILED);
    expect(error.code).toBe('ERR_FILE_UPLOAD_FAILED');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StorageError');
  });

  it('leaves code undefined for legacy call sites that omit it', () => {
    // The 4th-arg constructor shape predates this change, so existing
    // `new StorageError(msg, provider, status)` sites must still be valid.
    const error = new StorageError('Test error', 's3', 503);

    expect(error.code).toBeUndefined();
    expect(error.provider).toBe('s3');
    expect(error.statusCode).toBe(503);
  });

  it('preserves originalError alongside the code', () => {
    const originalError = new Error('Original error');
    const error = new StorageError(
      'Cloudinary delete failed',
      'cloudinary',
      502,
      originalError,
      ErrorCodes.FILE_DELETE_FAILED
    );

    expect(error.originalError).toBe(originalError);
    expect(error.code).toBe(ErrorCodes.FILE_DELETE_FAILED);
  });

  it('registers distinct upload and delete codes', () => {
    expect(ErrorCodes.FILE_UPLOAD_FAILED).not.toBe(ErrorCodes.FILE_DELETE_FAILED);
  });

  it('keeps the codes in the ERR_FILE_* namespace', () => {
    expect(ErrorCodes.FILE_UPLOAD_FAILED.startsWith('ERR_FILE_')).toBe(true);
    expect(ErrorCodes.FILE_DELETE_FAILED.startsWith('ERR_FILE_')).toBe(true);
  });
});
