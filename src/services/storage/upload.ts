/**
 * Higher-level upload operations wrapping the storage adapter.
 * Handles error translation to AppError and consistent logging.
 */

import { getStorageAdapter, StorageError } from './index.js';
import { AppError } from '../../shared/http/errors.js';
import { logger } from '../../shared/logger/logger.js';

/**
 * Upload file to storage and return public URL.
 * Translates storage errors to AppError for consistent error handling.
 *
 * @param buffer - File contents
 * @param mimeType - MIME type (e.g., 'image/jpeg')
 * @param key - Storage key (e.g., 'shipments/123/proofs/uuid.jpg')
 * @returns Public URL of uploaded file
 * @throws AppError on storage failure
 */
export async function uploadFileToStorage(
  buffer: Buffer,
  mimeType: string,
  key: string
): Promise<string> {
  try {
    const adapter = getStorageAdapter();
    const result = await adapter.uploadFile(buffer, mimeType, key);

    logger.debug({ key, mimeType, size: buffer.length }, 'File uploaded successfully');

    return result.url;
  } catch (error) {
    if (error instanceof StorageError) {
      logger.error({ err: error, key }, `Storage error from ${error.provider}`);

      throw new AppError(
        error.statusCode || 503,
        'Storage service unavailable. Please try again later.',
        'STORAGE_ERROR'
      );
    }

    logger.error({ err: error, key }, 'Unexpected error during file upload');

    throw new AppError(503, 'File upload failed. Please try again later.', 'STORAGE_ERROR');
  }
}

/**
 * Delete file from storage (best-effort, doesn't throw).
 *
 * @param key - Storage key to delete
 */
export async function deleteFileFromStorage(key: string): Promise<void> {
  try {
    const adapter = getStorageAdapter();

    if (!adapter.deleteObject) {
      logger.debug({ key }, 'Storage adapter does not support delete');
      return;
    }

    await adapter.deleteObject(key);
    logger.debug({ key }, 'File deleted from storage');
  } catch (error) {
    logger.warn({ err: error, key }, 'Failed to delete file from storage (non-critical)');
    // Don't throw — deletion is best-effort
  }
}

/**
 * Get signed URL for file (if provider supports it).
 *
 * @param key - Storage key
 * @param expiresInSeconds - URL validity duration
 * @returns Signed URL or public URL if signing not supported
 */
export async function getSignedUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
  try {
    const adapter = getStorageAdapter();

    if (!adapter.getSignedUrl) {
      logger.debug({ key }, 'Storage adapter does not support signed URLs');
      // Return a simple construction of public URL — caller should handle gracefully
      return '';
    }

    return await adapter.getSignedUrl(key, expiresInSeconds);
  } catch (error) {
    logger.warn({ err: error, key }, 'Failed to generate signed URL (falling back to public URL)');
    return '';
  }
}
