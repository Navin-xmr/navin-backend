import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import { AppError, ErrorCodes } from '../src/shared/http/errors.js';
import { verifyStellarSignature } from '../src/shared/middleware/verifyStellarSignature.js';
import {
  CHAIN_EVENT_NAMES,
  NAVIN_ERRORS,
  CHAIN_SPEC_VERSION,
  ChainFunctionArgsSchemas,
  chainErrorToAppError,
  parseChainEvent,
  verifyAnchoredLedger,
} from '../src/shared/types/chain.js';

/**
 * #1059 — one negative test per control in docs/chain-threat-model.md.
 */
const ACTOR = `G${'A'.repeat(55)}`;

function webhookRequest(signature?: string) {
  return {
    headers: signature ? { 'x-stellar-signature': signature } : {},
    rawBody: Buffer.from('{"event":"esc_rel"}'),
  } as unknown as Request;
}

function expectAppError(run: () => void, statusCode: number, code: string): void {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(statusCode);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Expected AppError(${statusCode}, ${code})`);
}

describe('T3 — forged webhook is rejected', () => {
  const next = jest.fn() as unknown as NextFunction;
  const res = {} as Response;

  it('rejects a missing signature with 401', () => {
    expectAppError(
      () => verifyStellarSignature(webhookRequest(), res, next),
      401,
      ErrorCodes.UNAUTHORIZED
    );
  });

  it('rejects a forged signature with 401 (constant-time compare)', () => {
    expectAppError(
      () => verifyStellarSignature(webhookRequest('ff'.repeat(32)), res, next),
      401,
      ErrorCodes.UNAUTHORIZED
    );
  });
});

describe('T4 — backend/on-chain role confusion is rejected', () => {
  it('v2 release args reject the legacy payment_id/proof_hash shape', () => {
    expect(
      ChainFunctionArgsSchemas.release_escrow.safeParse({
        payment_id: 'legacy-payment',
        proof_hash: 'a'.repeat(64),
      }).success
    ).toBe(false);
  });

  it('v2 release args require the authorized caller and a shipment', () => {
    expect(
      ChainFunctionArgsSchemas.release_escrow.parse({ caller: ACTOR, shipment_id: 'ship_1' })
    ).toEqual({ caller: ACTOR, shipment_id: 'ship_1' });
  });

  it('surfaces Unauthorized and InvalidStatus as coded AppErrors', () => {
    const unauthorized = chainErrorToAppError(NAVIN_ERRORS.Unauthorized);
    const invalidStatus = chainErrorToAppError(NAVIN_ERRORS.InvalidStatus);
    expect(unauthorized).toBeInstanceOf(AppError);
    expect(unauthorized.code).toBe(ErrorCodes.CHAIN_UNAUTHORIZED);
    expect(invalidStatus.code).toBe(ErrorCodes.CHAIN_INVALID_STATUS);
    expect(invalidStatus.statusCode).toBe(409);
  });
});

describe('T5 — hash substitution / event drift is rejected', () => {
  const event = {
    id: '0002200479567253504-0000000001',
    contract_id: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
    tx_hash: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
    ledger: 512345,
    ledger_closed_at: '2026-09-27T10:15:30Z',
    name: CHAIN_EVENT_NAMES.ANCHOR,
    topic: [CHAIN_EVENT_NAMES.ANCHOR, 'ship_1'],
    data: ['ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', 512345],
  };

  it('rejects an event with a substituted (non-hex) data hash', () => {
    expectAppError(
      () => parseChainEvent({ ...event, data: ['not-a-hash', 512345] }),
      502,
      ErrorCodes.CHAIN_INVALID_EVENT
    );
  });

  it('rejects an event carrying an unknown top-level field (spec drift)', () => {
    expectAppError(
      () => parseChainEvent({ ...event, proof_hash: 'injected' }),
      502,
      ErrorCodes.CHAIN_INVALID_EVENT
    );
  });

  it('pins the v2 spec version in error messages', () => {
    expect(CHAIN_SPEC_VERSION).toBe('2.2.0');
  });
});

describe('T6 — verification cannot be downgraded', () => {
  it('a record at 10 confirmations stays verified', () => {
    expect(verifyAnchoredLedger(100, 110).verified).toBe(true);
  });

  it('a record at 2 confirmations is not verified', () => {
    expect(verifyAnchoredLedger(100, 102).verified).toBe(false);
  });
});
