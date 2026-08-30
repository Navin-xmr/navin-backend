/**
 * Cloudinary storage adapter for image/video uploads.
 *
 * Requires:
 * - CLOUDINARY_CLOUD_NAME: Cloudinary cloud name
 * - CLOUDINARY_API_KEY: API key
 * - CLOUDINARY_API_SECRET: API secret
 *
 * Note: Cloudinary is optimized for image transformations and public CDN delivery.
 * For document uploads, S3/R2 is recommended.
 */

import { StorageAdapter, StorageUploadResult, StorageError } from './types.js';
import { logger } from '../../shared/logger/logger.js';

/**
 * Dynamic import to avoid requiring cloudinary at build time.
 * Users must install 'cloudinary' to use Cloudinary adapter.
 */
async function getCloudinaryUploader(config: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}) {
  try {
    const cloudinary = await import('cloudinary');
    const { v2 } = cloudinary.default;

    v2.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });

    return { uploader: v2.uploader };
  } catch {
    throw new StorageError(
      'cloudinary package not installed. Install: npm install cloudinary',
      'cloudinary',
      500
    );
  }
}

type CloudinaryUploadResult = {
  secure_url: string;
  public_id: string;
};

type CloudinaryUploadCallback = (error: unknown, result?: CloudinaryUploadResult) => void;
type CloudinaryDestroyCallback = (error: unknown, result?: unknown) => void;
type CloudinaryUploader = {
  upload_stream: (
    options: {
      public_id: string;
      resource_type: 'video' | 'image';
      overwrite: boolean;
    },
    callback: CloudinaryUploadCallback
  ) => { end: (buffer: Buffer) => void };
  destroy: (key: string, callback: CloudinaryDestroyCallback) => void;
};

export class CloudinaryStorageAdapter implements StorageAdapter {
  private uploader: unknown = null;

  constructor(
    private config: {
      cloudName: string;
      apiKey: string;
      apiSecret: string;
    }
  ) {}

  private async initializeUploader() {
    if (this.uploader) return;

    try {
      const { uploader } = await getCloudinaryUploader(this.config);
      this.uploader = uploader as CloudinaryUploader;
      logger.info('Cloudinary storage initialized');
    } catch (error) {
      throw new StorageError(
        `Failed to initialize Cloudinary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'cloudinary',
        500,
        error instanceof Error ? error : undefined
      );
    }
  }

  async uploadFile(buffer: Buffer, mimeType: string, key: string): Promise<StorageUploadResult> {
    try {
      await this.initializeUploader();

      const uploader = this.uploader as CloudinaryUploader | null;
      if (!uploader) {
        throw new StorageError('Cloudinary uploader is not initialized', 'cloudinary', 500);
      }

      return new Promise((resolve, reject) => {
        // Create readable stream from buffer
        const stream = uploader.upload_stream(
          {
            public_id: key,
            resource_type: mimeType.startsWith('video/') ? 'video' : 'image',
            overwrite: true,
          },
          (error: unknown, result?: CloudinaryUploadResult) => {
            if (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            } else if (result) {
              resolve({
                url: result.secure_url,
                key: result.public_id,
              });
            } else {
              reject(new Error('Cloudinary upload returned no result'));
            }
          }
        );

        stream.end(buffer);
      });
    } catch (error) {
      logger.error({ err: error, key }, 'Upload failed on Cloudinary');

      throw new StorageError(
        `Failed to upload file to Cloudinary: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        'cloudinary',
        503,
        error instanceof Error ? error : undefined
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.initializeUploader();

      const uploader = this.uploader as CloudinaryUploader | null;
      if (!uploader) {
        return;
      }

      return new Promise<void>((resolve, reject) => {
        uploader.destroy(key, (error: unknown, _result?: unknown) => {
          if (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          } else {
            logger.debug(`File deleted from Cloudinary: ${key}`);
            resolve();
          }
        });
      });
    } catch (error) {
      logger.warn({ err: error, key }, 'Failed to delete file from Cloudinary');
      // Don't throw on delete failure
    }
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    try {
      await this.initializeUploader();

      // Cloudinary doesn't use traditional signed URLs; instead use auth_token
      // For simplicity, return the public URL
      // In production, implement auth_token logic if needed
      const timestamp = Math.floor(Date.now() / 1000) + expiresInSeconds;

      // This is a basic implementation; Cloudinary's auth_token is more complex
      return `https://res.cloudinary.com/${this.config.cloudName}/image/upload/${key}?_a=${timestamp}`;
    } catch (error) {
      logger.warn({ err: error, key }, 'Failed to generate signed URL from Cloudinary');

      return `https://res.cloudinary.com/${this.config.cloudName}/image/upload/${key}`;
    }
  }
}
