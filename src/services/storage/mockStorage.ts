/**
 * Mock storage adapter for testing and development without cloud credentials.
 * Returns fake URLs with artificial latency to simulate real upload behavior.
 */

import { StorageAdapter, StorageUploadResult } from './types.js';

export class MockStorageAdapter implements StorageAdapter {
  async uploadFile(_buffer: Buffer, _mimeType: string, key: string): Promise<StorageUploadResult> {
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, 500));

    const mockUrl = `https://mock-storage.local/${key}?mock=1&ts=${Date.now()}`;

    return {
      url: mockUrl,
      key,
    };
  }

  async deleteObject(_key: string): Promise<void> {
    // No-op for mock
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  async getSignedUrl(key: string, _expiresInSeconds: number): Promise<string> {
    // Return mock URL (same as public URL for mock provider)
    return `https://mock-storage.local/${key}?signed=1&ts=${Date.now()}`;
  }
}
