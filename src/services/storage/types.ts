/**
 * Storage adapter contract for multi-provider file uploads.
 *
 * Implementations support AWS S3, Cloudflare R2, Cloudinary, and mock storage.
 * This abstraction allows switching providers via STORAGE_PROVIDER env var.
 */

export interface StorageAdapter {
  /**
   * Persist file bytes under a stable object key and return public/signed URL.
   *
   * @param buffer - File contents in memory
   * @param mimeType - MIME type (e.g., 'image/jpeg', 'application/pdf')
   * @param key - Stable storage key (e.g., 'shipments/123/proofs/uuid.jpg')
   * @returns Promise resolving to object URL and storage key
   * @throws StorageError on network, permissions, or quota issues
   */
  uploadFile(buffer: Buffer, mimeType: string, key: string): Promise<StorageUploadResult>;

  /**
   * Optional: delete object from storage.
   * Falls back to no-op if provider doesn't support it.
   */
  deleteObject?(key: string): Promise<void>;

  /**
   * Optional: generate signed URL valid for limited time.
   * Useful for private/gated access.
   */
  getSignedUrl?(key: string, expiresInSeconds: number): Promise<string>;
}

/**
 * Result of successful upload operation.
 */
export interface StorageUploadResult {
  /** Public or signed URL accessible via HTTP(S) */
  url: string;
  /** Storage key for future reference (delete, re-sign, etc.) */
  key: string;
}

/**
 * Configuration for storage provider.
 */
export interface StorageConfig {
  provider: 'mock' | 's3' | 'r2' | 'cloudinary';
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
}

/**
 * Provider-agnostic storage error.
 */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly statusCode: number = 500,
    readonly originalError?: Error
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
