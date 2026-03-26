import { describe, expect, beforeEach, it, jest, afterEach, afterAll } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { generateApiKey, validateApiKey, revokeApiKey, listApiKeys } from '../src/modules/auth/apiKey.service.js';
import { ApiKeyModel } from '../src/modules/auth/apiKey.model.js';

describe('API Key Service', () => {
  let mongoServer: MongoMemoryServer;

  beforeEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    await ApiKeyModel.deleteMany({});
  });

  afterEach(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe('generateApiKey', () => {
    it('generates a secure API key and stores hashed version', async () => {
      const result = await generateApiKey({
        name: 'Test API Key',
        organizationId: '507f1f77bcf86cd799439011',
      });

      expect(result.apiKey).toBeDefined();
      expect(result.apiKey).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(result.id).toBeDefined();
      expect(result.name).toBe('Test API Key');
      expect(result.organizationId).toBe('507f1f77bcf86cd799439011');
      expect(result.createdAt).toBeInstanceOf(Date);

      // Verify the raw key is not stored in database
      const storedKey = await ApiKeyModel.findById(result.id);
      expect(storedKey).toBeDefined();
      expect(storedKey!.keyHash).not.toBe(result.apiKey);
      expect(storedKey!.keyHash).toHaveLength(60); // bcrypt hash length
    });

    it('generates API key with shipmentId', async () => {
      const result = await generateApiKey({
        name: 'Shipment API Key',
        organizationId: '507f1f77bcf86cd799439011',
        shipmentId: '507f1f77bcf86cd799439012',
      });

      expect(result.shipmentId).toBe('507f1f77bcf86cd799439012');

      const storedKey = await ApiKeyModel.findById(result.id);
      expect(storedKey!.shipmentId?.toString()).toBe('507f1f77bcf86cd799439012');
    });

    it('generates unique API keys', async () => {
      const result1 = await generateApiKey({
        name: 'Key 1',
        organizationId: '507f1f77bcf86cd799439011',
      });

      const result2 = await generateApiKey({
        name: 'Key 2',
        organizationId: '507f1f77bcf86cd799439011',
      });

      expect(result1.apiKey).not.toBe(result2.apiKey);
      expect(result1.id).not.toBe(result2.id);
    });
  });

  describe('validateApiKey', () => {
    it('validates correct API key', async () => {
      const { apiKey } = await generateApiKey({
        name: 'Valid Key',
        organizationId: '507f1f77bcf86cd799439011',
      });

      const result = await validateApiKey(apiKey);

      expect(result.isValid).toBe(true);
      expect(result.apiKeyDoc).toBeDefined();
      expect(result.apiKeyDoc!.name).toBe('Valid Key');
    });

    it('rejects invalid API key', async () => {
      await generateApiKey({
        name: 'Valid Key',
        organizationId: '507f1f77bcf86cd799439011',
      });

      const result = await validateApiKey('invalid-key-12345');

      expect(result.isValid).toBe(false);
      expect(result.apiKeyDoc).toBeUndefined();
    });

    it('rejects empty API key', async () => {
      const result = await validateApiKey('');

      expect(result.isValid).toBe(false);
      expect(result.apiKeyDoc).toBeUndefined();
    });

    it('updates lastUsedAt timestamp on successful validation', async () => {
      const { apiKey, id } = await generateApiKey({
        name: 'Test Key',
        organizationId: '507f1f77bcf86cd799439011',
      });

      const beforeValidation = await ApiKeyModel.findById(id);
      expect(beforeValidation!.lastUsedAt).toBeUndefined();

      await validateApiKey(apiKey);

      const afterValidation = await ApiKeyModel.findById(id);
      expect(afterValidation!.lastUsedAt).toBeInstanceOf(Date);
    });

    it('rejects inactive API key', async () => {
      const { apiKey, id } = await generateApiKey({
        name: 'Inactive Key',
        organizationId: '507f1f77bcf86cd799439011',
      });

      await ApiKeyModel.updateOne({ _id: id }, { isActive: false });

      const result = await validateApiKey(apiKey);

      expect(result.isValid).toBe(false);
    });
  });

  describe('revokeApiKey', () => {
    it('revokes an active API key', async () => {
      const { id, apiKey } = await generateApiKey({
        name: 'To Revoke',
        organizationId: '507f1f77bcf86cd799439011',
      });

      await revokeApiKey(id);

      const revokedKey = await ApiKeyModel.findById(id);
      expect(revokedKey!.isActive).toBe(false);

      // Verify it can no longer be used
      const result = await validateApiKey(apiKey);
      expect(result.isValid).toBe(false);
    });

    it('throws error when API key not found', async () => {
      await expect(revokeApiKey('507f1f77bcf86cd799439099')).rejects.toThrow('API key not found');
    });
  });

  describe('listApiKeys', () => {
    it('lists active API keys for organization', async () => {
      const orgId = '507f1f77bcf86cd799439011';

      await generateApiKey({ name: 'Key 1', organizationId: orgId });
      await generateApiKey({ name: 'Key 2', organizationId: orgId });
      await generateApiKey({ name: 'Other Org Key', organizationId: '507f1f77bcf86cd799439012' });

      const keys = await listApiKeys(orgId);

      expect(keys).toHaveLength(2);
      expect(keys[0].name).toBe('Key 2'); // Most recent first
      expect(keys[1].name).toBe('Key 1');
    });

    it('does not include revoked keys', async () => {
      const orgId = '507f1f77bcf86cd799439011';

      const { id } = await generateApiKey({ name: 'Active Key', organizationId: orgId });
      const { id: revokedId } = await generateApiKey({ name: 'Revoked Key', organizationId: orgId });

      await revokeApiKey(revokedId);

      const keys = await listApiKeys(orgId);

      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('Active Key');
    });

    it('does not expose keyHash', async () => {
      const orgId = '507f1f77bcf86cd799439011';
      await generateApiKey({ name: 'Key 1', organizationId: orgId });

      const keys = await listApiKeys(orgId);

      expect(keys[0].toObject()).not.toHaveProperty('keyHash');
    });
  });
});
