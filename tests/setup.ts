import 'dotenv/config';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(30_000);
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long!';
process.env.NODE_ENV = 'test';

// Use MongoDB Memory Server URI if set by globalSetup
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test';

/**
 * Global test setup - runs before each test file
 * Clears all collections to ensure test isolation
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  // Use MongoDB Memory Server if MONGO_URI is not set
  if (!process.env.MONGO_URI || process.env.MONGO_URI.includes('127.0.0.1:27017')) {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
  }

  // Ensure we're connected to MongoDB
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 60_000);

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}, 60_000);

/**
 * Clear all collections between test files to prevent data bleeding
 */
afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const collection of Object.values(collections)) {
      try {
        await collection.deleteMany({});
      } catch {
        // Collection may not exist yet, skip
      }
    }
  }
}, 30_000);

// Reset all mocks between tests
afterEach(() => {
  jest.clearAllMocks();
});
