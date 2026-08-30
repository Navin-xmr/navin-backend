/**
 * S3-compatible storage adapter supporting AWS S3, Cloudflare R2, MinIO, and others.
 *
 * Requires:
 * - S3_BUCKET: bucket name
 * - S3_REGION: AWS region (optional for R2)
 * - S3_ENDPOINT: custom endpoint (optional for S3)
 * - S3_ACCESS_KEY: access key ID
 * - S3_SECRET_KEY: secret access key
 */

import { StorageAdapter, StorageUploadResult, StorageError } from './types.js';
import { logger } from '../../shared/logger/logger.js';

/**
 * Dynamic import to avoid requiring aws-sdk at build time.
 * Users must install @aws-sdk/client-s3 to use S3/R2 adapter.
 */
async function getS3Client(_config: {
  region: string;
  endpoint?: string;
  accessKey: string;
  secretKey: string;
}) {
  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    return { S3Client, PutObjectCommand };
  } catch {
    throw new StorageError(
      'aws-sdk/client-s3 not installed. Install: npm install @aws-sdk/client-s3',
      's3',
      500
    );
  }
}

export class S3StorageAdapter implements StorageAdapter {
  private client: unknown = null;
  private bucket: string;

  constructor(
    private config: {
      bucket: string;
      region: string;
      endpoint?: string;
      accessKey: string;
      secretKey: string;
      provider: 's3' | 'r2'; // for logging
    }
  ) {
    this.bucket = config.bucket;
  }

  private async initializeClient() {
    if (this.client) return;

    try {
      const { S3Client } = await getS3Client(this.config);

      this.client = new S3Client({
        region: this.config.region,
        endpoint: this.config.endpoint,
        credentials: {
          accessKeyId: this.config.accessKey,
          secretAccessKey: this.config.secretKey,
        },
      });

      logger.info(`S3-compatible storage initialized (provider: ${this.config.provider})`);
    } catch (error) {
      throw new StorageError(
        `Failed to initialize S3 client: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.config.provider,
        500,
        error instanceof Error ? error : undefined
      );
    }
  }

  async uploadFile(buffer: Buffer, mimeType: string, key: string): Promise<StorageUploadResult> {
    try {
      await this.initializeClient();

      const { PutObjectCommand } = await getS3Client(this.config);

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Enable public read if needed
        ACL: 'public-read',
      });

      const client = this.client as { send: (command: unknown) => Promise<unknown> } | null;
      if (!client) {
        throw new StorageError('S3 client is not initialized', this.config.provider, 500);
      }

      await client.send(command);

      // Build public URL based on provider
      const url = this.buildPublicUrl(key);

      logger.debug(`File uploaded to ${this.config.provider}: ${key}`);

      return { url, key };
    } catch (error) {
      logger.error(
        { err: error, key, bucket: this.bucket },
        `Upload failed on ${this.config.provider}`
      );

      throw new StorageError(
        `Failed to upload file to ${this.config.provider}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        this.config.provider,
        503,
        error instanceof Error ? error : undefined
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.initializeClient();

      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3').then(m => ({
        DeleteObjectCommand: m.DeleteObjectCommand,
      }));

      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const client = this.client as { send: (command: unknown) => Promise<unknown> } | null;
      if (!client) {
        return;
      }

      await client.send(command);
      logger.debug(`File deleted from ${this.config.provider}: ${key}`);
    } catch (error) {
      logger.warn({ err: error, key }, `Failed to delete file from ${this.config.provider}`);
      // Don't throw on delete failure — it's not critical
    }
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    try {
      await this.initializeClient();

      const { getSignedUrl: awsGetSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const client = this.client as Parameters<typeof awsGetSignedUrl>[0];
      const url = await awsGetSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
      });

      return url;
    } catch (error) {
      logger.warn(
        { err: error, key },
        `Failed to generate signed URL from ${this.config.provider}`
      );
      // Fallback to public URL
      return this.buildPublicUrl(key);
    }
  }

  private buildPublicUrl(key: string): string {
    if (this.config.endpoint) {
      // Custom endpoint (R2, MinIO, etc.)
      const endpoint = this.config.endpoint.replace(/\/$/, '');
      return `${endpoint}/${this.bucket}/${key}`;
    }

    // Standard AWS S3 URL format
    if (this.config.region === 'us-east-1') {
      return `https://${this.bucket}.s3.amazonaws.com/${key}`;
    }

    return `https://${this.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }
}
