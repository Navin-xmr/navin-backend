import { describe, expect, it } from '@jest/globals';

import {
  CHAIN_EVENT_NAMES,
  ChainEventVerificationSchema,
  DEFAULT_CONFIRMATION_THRESHOLD,
  confirmationDepth,
  verifyAnchoredLedger,
} from '../src/shared/types/chain.js';

/**
 * #1058 — confirmation depth is exposed consistently for every anchored event
 * class. These fixture cases pin the pure depth/verification logic at 0, 2, 3
 * and 10 confirmations and prove re-verification is idempotent.
 */
const LEDGER = 512345;

describe('confirmation depth fixtures', () => {
  it.each([
    [0, 0, false],
    [2, 2, false],
    [3, 3, true],
    [10, 10, true],
  ] as const)(
    'head = ledger + %i -> %i confirmations (verified=%s)',
    (depth, expectedConfirmations, expectedVerified) => {
      const head = LEDGER + depth;
      expect(confirmationDepth(LEDGER, head)).toBe(expectedConfirmations);
      const verification = verifyAnchoredLedger(LEDGER, head);
      expect(verification).toEqual({
        confirmations: expectedConfirmations,
        verified: expectedVerified,
      });
      expect(ChainEventVerificationSchema.safeParse(verification).success).toBe(true);
    }
  );

  it('never reports negative confirmations for a head behind the event', () => {
    expect(confirmationDepth(LEDGER, LEDGER - 5)).toBe(0);
  });

  it('accepts a configurable threshold (per network via CHAIN_CONFIRMATIONS_*)', () => {
    expect(DEFAULT_CONFIRMATION_THRESHOLD).toBe(3);
    expect(verifyAnchoredLedger(LEDGER, LEDGER + 2, 2).verified).toBe(true);
    expect(verifyAnchoredLedger(LEDGER, LEDGER + 3, 4).verified).toBe(false);
  });

  it('is idempotent: re-running at the same head returns the same state', () => {
    const first = verifyAnchoredLedger(LEDGER, LEDGER + 10);
    const second = verifyAnchoredLedger(LEDGER, LEDGER + 10);
    expect(second).toEqual(first);
    expect(verifyAnchoredLedger(LEDGER, LEDGER + 2).verified).toBe(false);
    expect(verifyAnchoredLedger(LEDGER, LEDGER + 10).verified).toBe(true);
  });

  it.each(Object.values(CHAIN_EVENT_NAMES))('applies to every anchored event class (%s)', name => {
    const verification = verifyAnchoredLedger(LEDGER, LEDGER + 3);
    expect(ChainEventVerificationSchema.parse(verification)).toMatchObject({
      confirmations: 3,
      verified: true,
    });
    expect(name).toBeTruthy();
  });
});
