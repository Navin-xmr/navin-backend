/**
 * Storage adapter tests covering all providers: mock, S3, R2, and Cloudinary.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MockStorageAdapter } from './mockStorage.js';
import { S3StorageAdapter } from './s3Storage.js';
import { CloudinaryStorageAdapter } from './cloudinaryStorage.js';
import { getStorageAdapter, resetStorageAdapter, StorageError } from './index.js';

describe('Storage Adapters', () => {
  const sampleBuffer = Buffer.from('test file content');
  const sampleMimeType = 'image/jpeg';
  const sampleKey = 'shipments/123/proofs/test-uuid.jpg';

  describe('MockStorageAdapter', () => {
    let adapter: MockStorageAdapter;

    beforeEach(() => {
      adapter = new MockStorageAdapter();
    });

    it('should upload file and return mock URL', async () => {
      const result = await adapter.uploadFile(sampleBuffer, sampleMimeType, sampleKey);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('key', sampleKey);
      expect(result.url).toContain('mock-storage.local');
      expect(result.url).toContain(sampleKey);
    });

    it('should simulate network latency', async () => {
      const startTime = Date.now();
      await adapter.uploadFile(sampleBuffer, sampleMimeType, sampleKey);
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(500);
    });

    it('should generate signed URL for mock', async () => {
      const signedUrl = await adapter.getSignedUrl(sampleKey, 3600);

      expect(signedUrl).toContain('mock-storage.local');
      expect(signedUrl).toContain(sampleKey);
      expect(signedUrl).toContain('signed=1');
    });

    it('should handle delete operation', async () => {
      await expect(adapter.deleteObject(sampleKey)).resolves.toBeUndefined();
    });
  });

  describe('S3StorageAdapter', () => {
    let adapter: S3StorageAdapter;
    let mockS3Client: { send: ReturnType<typeof jest.fn> };

    beforeEach(() => {
      // Mock S3 client
      mockS3Client = {
        send: jest.fn().mockResolvedValue({}),
      };

      // Create adapter with test config
      adapter = new S3StorageAdapter({
        bucket: 'test-bucket',
        region: 'us-east-1',
        accessKey: 'AKIA123456789',
        secretKey: 'secret-key-123',
        provider: 's3',
      });

      // Inject mock client
      (adapter as unknown as { client: typeof mockS3Client }).client = mockS3Client;
    });

    it('should build public URL for standard S3', () => {
      const url = (
        adapter as unknown as { buildPublicUrl: (key: string) => string }
      ).buildPublicUrl('test-key.jpg');

      expect(url).toBe('https://test-bucket.s3.amazonaws.com/test-key.jpg');
    });

    it('should build public URL for non-us-east-1 region', () => {
      adapter = new S3StorageAdapter({
        bucket: 'test-bucket',
        region: 'eu-west-1',
        accessKey: 'AKIA123456789',
        secretKey: 'secret-key-123',
        provider: 's3',
      });

      (adapter as unknown as { client: typeof mockS3Client }).client = mockS3Client;
      const url = (
        adapter as unknown as { buildPublicUrl: (key: string) => string }
      ).buildPublicUrl('test-key.jpg');

      expect(url).toBe('https://test-bucket.s3.eu-west-1.amazonaws.com/test-key.jpg');
    });

    it('should build public URL for custom endpoint (R2)', () => {
      adapter = new S3StorageAdapter({
        bucket: 'test-bucket',
        region: 'us-east-1',
        endpoint: 'https://r2.example.com',
        accessKey: 'AKIA123456789',
        secretKey: 'secret-key-123',
        provider: 'r2',
      });

      (adapter as unknown as { client: typeof mockS3Client }).client = mockS3Client;
      const url = (
        adapter as unknown as { buildPublicUrl: (key: string) => string }
      ).buildPublicUrl('test-key.jpg');

      expect(url).toBe('https://r2.example.com/test-bucket/test-key.jpg');
    });

    it('should handle upload with mocked client', async () => {
      (adapter as unknown as { client: typeof mockS3Client }).client = mockS3Client;

      // Mock the send method
      mockS3Client.send.mockResolvedValue({});

      const result = await adapter.uploadFile(sampleBuffer, sampleMimeType, sampleKey);

      expect(result.key).toBe(sampleKey);
      expect(result.url).toContain('s3.amazonaws.com');
    });

    it('should throw StorageError on missing credentials', () => {
      expect(() => {
        new S3StorageAdapter({
          bucket: '',
          region: 'us-east-1',
          accessKey: '',
          secretKey: '',
          provider: 's3',
        });
      }).toThrow();
    });
  });

  describe('CloudinaryStorageAdapter', () => {
    let adapter: CloudinaryStorageAdapter;

    beforeEach(() => {
      adapter = new CloudinaryStorageAdapter({
        cloudName: 'test-cloud',
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      });
    });

    it('should generate Cloudinary URL format', async () => {
      const signedUrl = await adapter.getSignedUrl('shipments/123/proof.jpg', 3600);

      expect(signedUrl).toContain('res.cloudinary.com');
      expect(signedUrl).toContain('test-cloud');
      expect(signedUrl).toContain('shipments/123/proof.jpg');
    });

    it('should handle Cloudinary config', () => {
      expect(adapter).toBeDefined();
      expect((adapter as unknown as { config: Record<string, string> }).config).toEqual({
        cloudName: 'test-cloud',
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      });
    });
  });

  describe('Storage Adapter Factory', () => {
    beforeEach(() => {
      resetStorageAdapter();
      // Reset env var
      delete process.env.STORAGE_PROVIDER;
    });

    afterEach(() => {
      resetStorageAdapter();
    });

    it('should default to mock adapter', () => {
      const adapter = getStorageAdapter();

      expect(adapter).toBeInstanceOf(MockStorageAdapter);
    });

    it('should create mock adapter when explicitly set', () => {
      process.env.STORAGE_PROVIDER = 'mock';
      resetStorageAdapter();

      const adapter = getStorageAdapter();

      expect(adapter).toBeInstanceOf(MockStorageAdapter);
    });

    it('should cache adapter instance', () => {
      const adapter1 = getStorageAdapter();
      const adapter2 = getStorageAdapter();

      expect(adapter1).toBe(adapter2);
    });

    it('should throw on unknown provider', () => {
      process.env.STORAGE_PROVIDER = 'unknown';
      resetStorageAdapter();

      expect(() => getStorageAdapter()).toThrow(StorageError);
    });

    it('should validate S3 credentials', () => {
      process.env.STORAGE_PROVIDER = 's3';
      // Don't set S3 env vars
      resetStorageAdapter();

      expect(() => getStorageAdapter()).toThrow(StorageError);
    });

    it('should validate Cloudinary credentials', () => {
      process.env.STORAGE_PROVIDER = 'cloudinary';
      // Don't set Cloudinary env vars
      resetStorageAdapter();

      expect(() => getStorageAdapter()).toThrow(StorageError);
    });
  });

  describe('Storage Adapter Error Handling', () => {
    it('should throw StorageError with proper properties', () => {
      const error = new StorageError('Test error', 's3', 503);

      expect(error).toBeInstanceOf(Error);
      expect(error.provider).toBe('s3');
      expect(error.statusCode).toBe(503);
      expect(error.message).toBe('Test error');
    });

    it('should include original error in StorageError', () => {
      const originalError = new Error('Original error');
      const storageError = new StorageError('Wrapper', 's3', 503, originalError);

      expect(storageError.originalError).toBe(originalError);
    });
  });
});
