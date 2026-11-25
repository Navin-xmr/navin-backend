/**
 * Sequence serialization tests (#1065).
 *
 * Validates that serializeSubmission prevents concurrent tx_bad_seq by
 * ensuring only one submission per account proceeds at a time.
 */
import { jest } from '@jest/globals';
import { serializeSubmission, closeSequenceLockClient } from '../src/services/chain/sequence-lock.js';

describe('Sequence Serialization (#1065)', () => {
  afterEach(async () => {
    await closeSequenceLockClient();
  });

  describe('serializeSubmission', () => {
    it('executes task and returns result', async () => {
      const result = await serializeSubmission('account-1', async () => {
        return 'success';
      });
      expect(result).toBe('success');
    });

    it('serializes N parallel calls for same account', async () => {
      const order: number[] = [];
      const account = 'shared-account';

      const tasks = [1, 2, 3].map(i =>
        serializeSubmission(account, async () => {
          order.push(i);
          // Simulate work
          await new Promise(resolve => setTimeout(resolve, 10));
          return i;
        })
      );

      const results = await Promise.all(tasks);

      // All completed
      expect(results).toEqual([1, 2, 3]);
      // Executed in order (in-process lock serializes them)
      expect(order).toEqual([1, 2, 3]);
    });

    it('allows concurrent calls for different accounts', async () => {
      const startTimes: number[] = [];

      const task = (account: string, id: number) =>
        serializeSubmission(account, async () => {
          startTimes.push(id);
          await new Promise(resolve => setTimeout(resolve, 50));
          return id;
        });

      const results = await Promise.all([
        task('account-a', 1),
        task('account-b', 2),
        task('account-a', 3),
        task('account-b', 4),
      ]);

      expect(results).toEqual([1, 2, 3, 4]);
      // Different accounts can run concurrently
      // (order is non-deterministic but tasks don't block each other)
      expect(startTimes.length).toBe(4);
    });

    it('propagates task errors without swallowing them', async () => {
      const error = new Error('Task failed');

      await expect(
        serializeSubmission('account-1', async () => {
          throw error;
        })
      ).rejects.toBe(error);
    });

    it('releases lock on task success', async () => {
      const account = 'test-account';

      await serializeSubmission(account, async () => {
        return 'done';
      });

      // Next call for same account should proceed immediately
      // (lock was released after first task)
      const start = Date.now();
      await serializeSubmission(account, async () => {
        return 'next';
      });
      const elapsed = Date.now() - start;

      // Should be fast (not waiting for another lock holder)
      expect(elapsed).toBeLessThan(100);
    });

    it('releases lock on task failure', async () => {
      const account = 'test-account';

      // First task fails
      await serializeSubmission(account, async () => {
        throw new Error('First failed');
      }).catch(() => {
        // Ignore error
      });

      // Second task should proceed immediately
      const start = Date.now();
      const result = await serializeSubmission(account, async () => {
        return 'recovered';
      });
      const elapsed = Date.now() - start;

      expect(result).toBe('recovered');
      // Should be fast (not waiting)
      expect(elapsed).toBeLessThan(100);
    });

    it('simulates N concurrent API calls without tx_bad_seq', async () => {
      const account = 'shared-keypair';
      let sequence = 100;
      const failures: string[] = [];

      const simulateSubmission = async (_id: number) => {
        return serializeSubmission(account, async () => {
          // Simulate: load account, check sequence
          const loadedSeq = sequence;
          // Simulate concurrent interference would happen here without lock
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          // Build tx with sequence+1
          const txSeq = loadedSeq + 1;
          // Simulate submit
          if (txSeq !== sequence + 1) {
            failures.push(`tx_bad_seq: expected ${sequence + 1}, got ${txSeq}`);
            throw new Error('tx_bad_seq');
          }
          // Advance sequence
          sequence = txSeq;
          return { txSeq };
        });
      };

      const results = await Promise.all([1, 2, 3, 4, 5].map(simulateSubmission));

      // No tx_bad_seq failures
      expect(failures).toEqual([]);
      // Sequence incremented correctly
      expect(sequence).toBe(105);
      // All succeeded
      expect(results).toHaveLength(5);
    });
  });
});
