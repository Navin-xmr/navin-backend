import { jest } from '@jest/globals';
import { AppError, ErrorCodes } from '../../src/shared/http/errors.js';
import type { ChainEvent } from '../../src/shared/types/chain.js';
import type { ChainAdapter, ChainTxReceipt } from '../../src/services/chain/types.js';

export interface FakeChainAdapterOptions {
  events?: readonly ChainEvent[];
  malformedEvents?: readonly unknown[];
  anchorFailures?: number;
  releaseFailures?: number;
}

/**
 * Deterministic fake ChainAdapter for tests.
 * Avoids Horizon network calls; returns stable tx_hash/ledger.
 * Use with `jest.unstable_mockModule` + `requireActual` spread.
 */
export function createFakeChainAdapter(
  overrides: Partial<ChainAdapter> = {},
  options: FakeChainAdapterOptions = {}
): ChainAdapter {
  let anchorFailures = options.anchorFailures ?? 0;
  let releaseFailures = options.releaseFailures ?? 0;

  return {
    anchorEvent: jest.fn(async () => {
      if (anchorFailures > 0) {
        anchorFailures -= 1;
        throw new AppError(502, 'Fake anchor failure', ErrorCodes.CHAIN_UNKNOWN);
      }
      return { txHash: 'a'.repeat(64), ledger: 1, simulated: true };
    }),
    releaseEscrow: jest.fn(async input => {
      if (releaseFailures > 0) {
        releaseFailures -= 1;
        throw new AppError(502, 'Fake escrow failure', ErrorCodes.CHAIN_UNKNOWN);
      }
      return {
        txHash: 'b'.repeat(64),
        ledger: 2,
        simulated: true,
        paymentId: input.payment_id,
      };
    }),
    streamEvents: (async function* (cursor) {
      let pastCursor = cursor === undefined;
      for (const event of [...(options.events ?? []), ...(options.malformedEvents ?? [])]) {
        const candidate = event as ChainEvent;
        if (!pastCursor) {
          if (candidate.id === cursor) pastCursor = true;
          continue;
        }
        yield candidate;
      }
    }) as ChainAdapter['streamEvents'],
    ...overrides,
  };
}

export const FAKE_TX: ChainTxReceipt = {
  tx_hash: 'c'.repeat(64),
  ledger: 3,
};
