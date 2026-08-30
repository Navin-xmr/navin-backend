import 'dotenv/config';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(30_000);
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long!';
process.env.STELLAR_WEBHOOK_SECRET = 'test-stellar-webhook-secret-key';
process.env.NODE_ENV = 'test';

// Use MongoDB Memory Server URI if set by globalSetup
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test';

/**
 * Global test setup - runs before each test file
 * Clears all collections to ensure test isolation
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer | null = null;
let mongoReady = false;

beforeAll(async () => {
  await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
    getRedisClient: () => ({
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
      exists: jest.fn(async () => 0),
    }),
    getRedisConnection: () => ({
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
    }),
    disconnectRedis: jest.fn(async () => undefined),
  }));

  try {
    // Prefer MongoMemoryServer when pointing at the default local URI.
    // Set SKIP_MONGO_MEMORY=1 to skip (fully mocked unit suites / no MMS binary).
    if (
      process.env.SKIP_MONGO_MEMORY !== '1' &&
      (!process.env.MONGO_URI || process.env.MONGO_URI.includes('127.0.0.1:27017'))
    ) {
      mongoServer = await MongoMemoryServer.create({
        binary: { checkMD5: false },
      });
      process.env.MONGO_URI = mongoServer.getUri();
    }

    if (process.env.SKIP_MONGO_MEMORY === '1') {
      mongoReady = false;
      return;
    }

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI);
    }
    mongoReady = mongoose.connection.readyState === 1;
  } catch (err) {
    // Allow fully-mocked unit suites to run when the MMS binary is unavailable.
    // Integration tests that need a live DB will fail individually.
    console.warn(
      '[tests/setup] MongoDB unavailable — continuing without a live DB connection:',
      err instanceof Error ? err.message : err
    );
    mongoReady = false;
  }
}, 180_000);

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
  if (mongoReady && mongoose.connection.readyState === 1) {
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
