/**
 * Storage adapter factory and singleton management.
 *
 * Dynamically selects and initializes the appropriate storage provider
 * based on STORAGE_PROVIDER environment variable.
 *
 * Supported providers:
 * - mock: Local development (no credentials needed)
 * - s3: AWS S3
 * - r2: Cloudflare R2 (S3-compatible endpoint)
 * - cloudinary: Cloudinary CDN (image-optimized)
 */

import { StorageAdapter, StorageError } from './types.js';
import { MockStorageAdapter } from './mockStorage.js';
import { S3StorageAdapter } from './s3Storage.js';
import { CloudinaryStorageAdapter } from './cloudinaryStorage.js';
import { env } from '../../env.js';
import { logger } from '../../shared/logger/logger.js';

let storageAdapterInstance: StorageAdapter | null = null;

/**
 * Get or create the storage adapter based on environment configuration.
 *
 * @returns Configured storage adapter instance
 * @throws StorageError if configuration is invalid or initialization fails
 */
export function getStorageAdapter(): StorageAdapter {
  if (storageAdapterInstance) {
    return storageAdapterInstance;
  }

  const provider = process.env.STORAGE_PROVIDER || 'mock';

  switch (provider) {
    case 'mock':
      storageAdapterInstance = new MockStorageAdapter();
      logger.info('Storage adapter: mock (development mode)');
      break;

    case 's3':
      storageAdapterInstance = createS3Adapter('s3');
      break;

    case 'r2':
      storageAdapterInstance = createS3Adapter('r2');
      break;

    case 'cloudinary':
      storageAdapterInstance = createCloudinaryAdapter();
      break;

    default:
      throw new StorageError(
        `Unknown STORAGE_PROVIDER: ${provider}. Expected: mock, s3, r2, or cloudinary`,
        provider,
        400
      );
  }

  return storageAdapterInstance;
}

/**
 * Create S3-compatible adapter (for AWS S3, Cloudflare R2, MinIO, etc.)
 */
function createS3Adapter(provider: 's3' | 'r2'): StorageAdapter {
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION || 'us-east-1';
  const accessKey = env.S3_ACCESS_KEY;
  const secretKey = env.S3_SECRET_KEY;
  const endpoint = env.S3_ENDPOINT;

  if (!bucket || !accessKey || !secretKey) {
    throw new StorageError(
      `S3 storage requires S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY env vars`,
      provider,
      400
    );
  }

  logger.info(`Storage adapter: ${provider} (bucket: ${bucket})`);

  return new S3StorageAdapter({
    bucket,
    region,
    endpoint,
    accessKey,
    secretKey,
    provider,
  });
}

/**
 * Create Cloudinary adapter.
 */
function createCloudinaryAdapter(): StorageAdapter {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new StorageError(
      `Cloudinary storage requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET env vars`,
      'cloudinary',
      400
    );
  }

  logger.info('Storage adapter: cloudinary');

  return new CloudinaryStorageAdapter({
    cloudName,
    apiKey,
    apiSecret,
  });
}

/**
 * Reset adapter instance (useful for testing).
 */
export function resetStorageAdapter(): void {
  storageAdapterInstance = null;
}

export type { StorageAdapter, StorageUploadResult, StorageConfig } from './types.js';
export { StorageError } from './types.js';
