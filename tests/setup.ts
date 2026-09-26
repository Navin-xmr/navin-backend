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
  try {
    // A shared MongoDB Memory Server is provided by tests/globalSetup.ts
    // (MONGO_MEMORY_SHARED=1). Only spawn a per-file server when running
    // without it. Set SKIP_MONGO_MEMORY=1 to skip (fully mocked unit suites).
    if (
      process.env.SKIP_MONGO_MEMORY !== '1' &&
      process.env.MONGO_MEMORY_SHARED !== '1' &&
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
    mongoServer = null;
  }
  // Release shared infrastructure handles so `jest --runInBand` exits
  // naturally without `--forceExit` and never depends on a live Redis.
  try {
    const { disconnectRedis } = await import('../src/infra/redis/connection.js');
    await disconnectRedis();
  } catch {
    // Teardown must never fail the suite.
  }
  try {
    const { closeSseHub } = await import('../src/infra/sse/sseHub.js');
    await closeSseHub();
  } catch {
    // Ignore — suite may never have initialized the hub.
  }
  try {
    const { closeSocketIO } = await import('../src/infra/socket/io.js');
    await closeSocketIO();
  } catch {
    // Ignore — suite may never have initialized Socket.IO.
  }
  try {
    const { disconnectQueueRedis } = await import('../src/infra/redis/queue.js');
    await disconnectQueueRedis();
  } catch {
    // Ignore — suite may never have touched the queue module.
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
  // Heal NODE_ENV poisoning: suites such as swaggerDocs/errorMiddleware flip
  // NODE_ENV mid-test and restore it in their own afterEach, but if one ever
  // leaks, every later test in the file would take production code paths.
  process.env.NODE_ENV = 'test';
});

// Clear per-test SSE registrations (heartbeat timers) so no suite leaks
// intervals into the next file when running `--runInBand`.
afterEach(async () => {
  try {
    const { resetSseHubForTest } = await import('../src/infra/sse/sseHub.js');
    resetSseHubForTest();
  } catch {
    // Ignore — module may be mocked in this suite.
  }
});
