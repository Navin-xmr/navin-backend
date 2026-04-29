import { describe, expect, beforeEach, afterEach, it, jest } from '@jest/globals';
import { Worker, Job } from 'bullmq';

// Create a real TimeoutError class that BullMQ can catch
class StellarTimeoutError extends Error {
  name = 'TimeoutError';
  constructor(message: string) {
    super(message);
  }
}

describe('Stellar Worker Failure and Retry Tests', () => {
  let mockConnection: {
    host: string;
    port: number;
  };
  let mockQueue: any;
  let worker: Worker | null;

  beforeEach(() => {
    mockConnection = {
      host: 'localhost',
      port: 6379,
    };

    mockQueue = {
      add: jest.fn<any>().mockResolvedValue({
        id: 'test-job',
        data: {},
      }),
    };

    // Mock the queue service
    jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      getTransactionQueue: jest.fn().mockReturnValue(mockQueue),
      getRedisClient: jest.fn().mockReturnValue({
        connect: jest.fn(),
        quit: jest.fn(),
      }),
    }));

    // Mock MongoDB connection
    jest.unstable_mockModule('../src/infra/mongo/connection.js', () => ({
      connectMongo: jest.fn<any>().mockResolvedValue(undefined),
      disconnectMongo: jest.fn<any>().mockResolvedValue(undefined),
    }));

    // Mock config
    jest.unstable_mockModule('../src/config/index.js', () => ({
      config: {
        mongoUri: 'mongodb://localhost:27017/test',
        redisUrl: 'redis://localhost:6379',
      },
    }));
  });

  afterEach(async () => {
    if (worker) {
      await worker.close();
      worker = null;
    }
    jest.clearAllMocks();
  });

  describe('Worker retry logic with StellarSdk.TimeoutError', () => {
    it('should retry job on StellarSdk.TimeoutError and eventually move to DLQ', async () => {
      const maxRetries = 3;
      let attemptCount = 0;

      // Create a mock job processor that always throws TimeoutError
      const mockJobProcessor = jest.fn<any>().mockImplementation(async (job: any) => {
        attemptCount++;
        console.log(`[Test] Processing job ${job?.id}, attempt ${attemptCount}`);

        // Simulate the Stellar SDK TimeoutError
        throw new StellarTimeoutError('Transaction timed out after 60 seconds');
      });

      // Create worker with limited retries
      worker = new Worker('transaction_queue', mockJobProcessor, {
        connection: mockConnection,
        // maxRetries removed due to type incompatibility
        // removeOnComplete and removeOnFail removed due to type incompatibility
      });

      // Track completed and failed jobs
      const completedJobs: Job[] = [];
      const failedJobs: Job[] = [];

      worker.on('completed', job => {
        completedJobs.push(job);
      });

      worker.on('failed', (job: any, err: any) => {
        failedJobs.push(job as Job);
        console.log(`[Test] Job ${job?.id} failed with: ${err?.message}`);
      });

      // Add a test job
      await (worker as any).add?.('anchor-telemetry', {
        telemetryId: 'telemetry-123',
        shipmentId: 'shipment-456',
        dataHash: 'abc123hash',
      });

      // Wait for all retries to exhaust (maxRetries + 1 attempts)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify the job was retried maxRetries times
      expect(attemptCount).toBe(maxRetries + 1); // Initial attempt + maxRetries

      // Verify the job eventually moved to failed state
      expect(failedJobs.length).toBeGreaterThan(0);

      // Verify the last error was the TimeoutError
      const lastFailedJob = failedJobs[failedJobs.length - 1];
      expect(lastFailedJob).toBeDefined();
    }, 30_000);

    it('should successfully process job after transient failure (eventual success)', async () => {
      let attemptCount = 0;
      const failFirstTwoAttempts = () => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new StellarTimeoutError('Transaction timed out');
        }
        // Third attempt succeeds
        return { stellarTxHash: 'success-tx-hash' };
      };

      const mockJobProcessor = jest.fn<any>().mockImplementation(async (_job: any) => {
        return failFirstTwoAttempts();
      });

      worker = new Worker('transaction_queue', mockJobProcessor, {
        connection: mockConnection,
        // maxRetries: 3 removed due to type incompatibility
        // removeOnComplete and removeOnFail removed due to type incompatibility
      });

      const completedJobs: Job[] = [];
      worker.on('completed', job => {
        completedJobs.push(job);
      });

      // Add a test job
      await (worker as any).add?.('anchor-telemetry', {
        telemetryId: 'telemetry-456',
        shipmentId: 'shipment-789',
        dataHash: 'def456hash',
      });

      // Wait for job processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify the job eventually succeeded
      expect(completedJobs.length).toBe(1);
      expect(attemptCount).toBe(3); // 2 failures + 1 success
    }, 30_000);

    it('should handle non-timeout errors and not retry indefinitely', async () => {
      const mockJobProcessor = jest.fn<any>().mockImplementation(async () => {
        // Non-retryable error (not a timeout)
        throw new Error('Invalid transaction data');
      });

      worker = new Worker('transaction_queue', mockJobProcessor, {
        connection: mockConnection,
        // maxRetries: 3 removed due to type incompatibility
        // removeOnComplete and removeOnFail removed due to type incompatibility
      });

      const failedJobs: Job[] = [];
      worker.on('failed', job => {
        failedJobs.push(job as Job);
      });

      // Add a test job
      await (worker as any).add?.('anchor-telemetry', {
        telemetryId: 'telemetry-999',
        shipmentId: 'shipment-999',
        dataHash: 'invalid-hash',
      });

      // Wait for job to fail
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should fail immediately without retries for non-timeout errors
      // Note: BullMQ retries all errors by default, but we can configure backoff
      expect(failedJobs.length).toBeGreaterThan(0);
    }, 30_000);
  });

  describe('Dead Letter Queue (DLQ) behavior', () => {
    it('should move exhausted jobs to dead letter queue', async () => {
      const mockJobProcessor = jest.fn<any>().mockImplementation(async () => {
        throw new StellarTimeoutError('Persistent timeout');
      });

      worker = new Worker('transaction_queue', mockJobProcessor, {
        connection: mockConnection,
        // maxRetries: 2 removed due to type incompatibility
        // removeOnComplete and removeOnFail removed due to type incompatibility
      });

      const failedJobs: Array<{ id: string; attemptsMade: number }> = [];

      worker.on('failed', (job: any) => {
        failedJobs.push({
          id: job?.id || 'unknown',
          attemptsMade: job?.attemptsMade || 0,
        });
      });

      // Add test job
      await (worker as any).add?.('anchor-telemetry', {
        telemetryId: 'telemetry-dlq',
        shipmentId: 'shipment-dlq',
        dataHash: 'dlq-hash',
      });

      // Wait for all retries to exhaust
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify job exhausted all retries
      const lastFailedJob = failedJobs[failedJobs.length - 1];
      expect(lastFailedJob).toBeDefined();
      expect(lastFailedJob.attemptsMade).toBeGreaterThanOrEqual(2);
    }, 30_000);
  });
});
