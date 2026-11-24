/**
 * #1078 / #1081 — SorobanAdapter submission reliability and preflight.
 *
 * The RPC pipeline (`invokePipeline`) and the confirmation lookup
 * (`getTransactionLedger`) are replaced so the retry, duplicate-detection,
 * idempotency and preflight logic around them is exercised without a network.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';

import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import type { ChainPreflightCheck } from '../src/config/chainPreflight.js';
import type { ChainStateReader } from '../src/services/chain/preflight.js';
import { AppError, ErrorCodes } from '../src/shared/http/errors.js';

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const SHIPMENT = '65f1a2b3c4d5e6f708192a3b';
const HASH = 'a'.repeat(64);
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);

type Pipeline = (
  op: unknown,
  onSent?: (txHash: string) => void
) => Promise<{ txHash: string; ledger: number }>;

const timeoutAfterSending = (txHash: string): Pipeline =>
  jest.fn<Pipeline>(async (_op, onSent) => {
    onSent?.(txHash);
    throw new AppError(504, 'polling timed out', ErrorCodes.CHAIN_SUBMISSION_TIMEOUT, { txHash });
  });

interface Harness {
  adapter: SorobanAdapter;
  invoke: jest.Mock<Pipeline>;
  ledgerOf: jest.Mock<(txHash: string) => Promise<number | null>>;
  sleep: jest.Mock<(ms: number) => Promise<void>>;
}

function makeAdapter(
  options: {
    preflight?: { enabled: boolean; checks: readonly ChainPreflightCheck[] };
    stateReader?: ChainStateReader;
    maxAttempts?: number;
  } = {}
): Harness {
  const sleep = jest.fn(async (_ms: number) => undefined);
  const adapter = new SorobanAdapter({
    secretKey: Keypair.random().secret(),
    contractId: CONTRACT_ID,
    preflight: options.preflight ?? { enabled: false, checks: [] },
    stateReader: options.stateReader,
    retry: { maxAttempts: options.maxAttempts ?? 3, baseDelayMs: 10, maxDelayMs: 100 },
    sleep,
  });
  const invoke = jest.fn<Pipeline>();
  const ledgerOf = jest.fn<(txHash: string) => Promise<number | null>>(async () => null);
  // Private seams: replaced at runtime so no RPC server is needed.
  Object.assign(adapter, { invokePipeline: invoke, getTransactionLedger: ledgerOf });
  return { adapter, invoke, ledgerOf, sleep };
}

const anchorInput = () => ({
  shipment_id: SHIPMENT,
  data_hash: HASH,
  actor: Keypair.random().publicKey(),
});

describe('SorobanAdapter submission retry and duplicate detection (#1078)', () => {
  it('retries a timeout when the earlier transaction did not land, and returns the new receipt', async () => {
    const { adapter, invoke, ledgerOf, sleep } = makeAdapter();
    invoke
      .mockImplementationOnce(timeoutAfterSending(H1))
      .mockResolvedValueOnce({ txHash: H2, ledger: 90 });

    const receipt = await adapter.anchorEvent(anchorInput());

    expect(receipt).toEqual({ txHash: H2, ledger: 90, simulated: false });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(ledgerOf).toHaveBeenCalledWith(H1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not resubmit when chain state shows the timed-out transaction confirmed', async () => {
    const { adapter, invoke, ledgerOf } = makeAdapter();
    invoke.mockImplementationOnce(timeoutAfterSending(H1));
    ledgerOf.mockResolvedValueOnce(77);

    const receipt = await adapter.anchorEvent(anchorInput());

    expect(receipt).toEqual({ txHash: H1, ledger: 77, simulated: false });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('resolves an "already anchored" rejection after a timeout from chain state, not the error', async () => {
    const { adapter, invoke, ledgerOf } = makeAdapter();
    invoke
      .mockImplementationOnce(timeoutAfterSending(H1))
      .mockRejectedValueOnce(new AppError(409, 'dup', ErrorCodes.CHAIN_ALREADY_ANCHORED));
    // Not confirmed when the retry starts, confirmed by the time it is rejected.
    ledgerOf.mockResolvedValueOnce(null).mockResolvedValueOnce(55);

    const receipt = await adapter.anchorEvent(anchorInput());

    expect(receipt).toEqual({ txHash: H1, ledger: 55, simulated: false });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('still surfaces "already anchored" when no earlier attempt was sent', async () => {
    const { adapter, invoke } = makeAdapter();
    invoke.mockRejectedValueOnce(new AppError(409, 'dup', ErrorCodes.CHAIN_ALREADY_ANCHORED));

    await expect(adapter.anchorEvent(anchorInput())).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_ALREADY_ANCHORED,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('is bounded: gives up with the timeout error after maxAttempts', async () => {
    const { adapter, invoke, sleep } = makeAdapter({ maxAttempts: 3 });
    invoke.mockImplementation(timeoutAfterSending(H1));

    await expect(adapter.anchorEvent(anchorInput())).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_SUBMISSION_TIMEOUT,
    });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry contract rejections', async () => {
    const { adapter, invoke } = makeAdapter();
    invoke.mockRejectedValueOnce(new AppError(409, 'exists', ErrorCodes.CHAIN_ESCROW_EXISTS));

    await expect(
      adapter.releaseEscrow({ caller: Keypair.random().publicKey(), shipment_id: SHIPMENT })
    ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_ESCROW_EXISTS });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('refuses to resubmit when an earlier attempt cannot be verified on chain', async () => {
    const { adapter, invoke, ledgerOf } = makeAdapter();
    invoke.mockImplementationOnce(timeoutAfterSending(H1));
    ledgerOf.mockRejectedValueOnce(new Error('rpc down'));

    await expect(adapter.anchorEvent(anchorInput())).rejects.toMatchObject({
      statusCode: 502,
      code: ErrorCodes.CHAIN_UNKNOWN,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  describe('idempotency by (shipment_id, event_type, event_counter)', () => {
    const options = { eventType: 'anchor', eventCounter: 1 };

    it('submits a repeated event once and returns the original receipt', async () => {
      const { adapter, invoke } = makeAdapter();
      invoke.mockResolvedValue({ txHash: H1, ledger: 10 });

      const first = await adapter.anchorEvent(anchorInput(), options);
      const second = await adapter.anchorEvent(anchorInput(), options);

      expect(second).toEqual(first);
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('submits again for a different event_counter', async () => {
      const { adapter, invoke } = makeAdapter();
      invoke.mockResolvedValue({ txHash: H1, ledger: 10 });

      await adapter.anchorEvent(anchorInput(), options);
      await adapter.anchorEvent(anchorInput(), { ...options, eventCounter: 2 });

      expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('concurrent repeats share one in-flight submission', async () => {
      const { adapter, invoke } = makeAdapter();
      invoke.mockImplementation(async () => ({ txHash: H1, ledger: 10 }));

      const [a, b] = await Promise.all([
        adapter.anchorEvent(anchorInput(), options),
        adapter.anchorEvent(anchorInput(), options),
      ]);

      expect(a).toEqual(b);
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed submission, so the event can be retried later', async () => {
      const { adapter, invoke } = makeAdapter({ maxAttempts: 1 });
      invoke
        .mockRejectedValueOnce(new AppError(400, 'bad', ErrorCodes.CHAIN_UNKNOWN))
        .mockResolvedValueOnce({ txHash: H2, ledger: 11 });

      await expect(adapter.anchorEvent(anchorInput(), options)).rejects.toBeInstanceOf(AppError);
      await expect(adapter.anchorEvent(anchorInput(), options)).resolves.toMatchObject({
        txHash: H2,
      });
    });

    it('without options nothing is deduplicated', async () => {
      const { adapter, invoke } = makeAdapter();
      invoke.mockResolvedValue({ txHash: H1, ledger: 10 });

      await adapter.anchorEvent(anchorInput());
      await adapter.anchorEvent(anchorInput());

      expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('an anchor and a release with the same event identity do not share a receipt', async () => {
      const { adapter, invoke } = makeAdapter();
      invoke.mockResolvedValue({ txHash: H1, ledger: 10 });

      await adapter.anchorEvent(anchorInput(), options);
      const release = await adapter.releaseEscrow(
        { caller: Keypair.random().publicKey(), shipment_id: SHIPMENT },
        { ...options, shipmentId: SHIPMENT }
      );

      expect(release.shipmentId).toBe(SHIPMENT);
      expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('rejects an invalid event identity before touching the chain', async () => {
      const { adapter, invoke } = makeAdapter();

      await expect(
        adapter.anchorEvent(anchorInput(), { eventType: 'anchor', eventCounter: -1 })
      ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_INVALID_IDEMPOTENCY_KEY });
      expect(invoke).not.toHaveBeenCalled();
    });

    it('a release with options rejects an empty shipment id for its key', async () => {
      const { adapter, invoke } = makeAdapter();

      await expect(
        adapter.releaseEscrow(
          { caller: Keypair.random().publicKey(), shipment_id: SHIPMENT },
          { ...options, shipmentId: '' }
        )
      ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_INVALID_IDEMPOTENCY_KEY });
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});

describe('SorobanAdapter preflight (#1081)', () => {
  let reader: jest.Mocked<ChainStateReader>;

  beforeEach(() => {
    reader = {
      isInitialized: jest.fn(async () => true),
      hasRole: jest.fn(async () => true),
      isCarrierWhitelisted: jest.fn(async () => true),
      isSuspended: jest.fn(async () => false),
      getTokenDecimals: jest.fn(async () => 7),
    };
  });

  const enabledChecks = (checks: readonly ChainPreflightCheck[]) => ({ enabled: true, checks });

  it('runs preflight before signing and blocks the submission on failure', async () => {
    reader.isInitialized.mockResolvedValueOnce(false);
    const { adapter, invoke } = makeAdapter({
      preflight: enabledChecks(['initialized']),
      stateReader: reader,
    });

    await expect(adapter.anchorEvent(anchorInput())).rejects.toMatchObject({
      statusCode: 503,
      code: ErrorCodes.CHAIN_NOT_INITIALIZED,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('checks the anchor actor against roles, whitelist and suspension', async () => {
    reader.isSuspended.mockResolvedValueOnce(true);
    const { adapter, invoke } = makeAdapter({
      preflight: enabledChecks(['roles', 'suspension']),
      stateReader: reader,
    });
    const input = anchorInput();

    await expect(adapter.anchorEvent(input)).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_ACTOR_SUSPENDED,
    });
    expect(reader.hasRole).toHaveBeenCalledWith(input.actor, 'Company');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('passes through to the chain when every check succeeds', async () => {
    const { adapter, invoke } = makeAdapter({
      preflight: enabledChecks(['initialized', 'roles', 'whitelist', 'suspension']),
      stateReader: reader,
    });
    invoke.mockResolvedValueOnce({ txHash: H1, ledger: 5 });

    await expect(adapter.anchorEvent(anchorInput())).resolves.toMatchObject({ txHash: H1 });
    expect(reader.isInitialized).toHaveBeenCalledTimes(1);
  });

  it('checks initialization before releasing escrow', async () => {
    reader.isInitialized.mockResolvedValueOnce(false);
    const { adapter, invoke } = makeAdapter({
      preflight: enabledChecks(['initialized']),
      stateReader: reader,
    });

    await expect(
      adapter.releaseEscrow({ caller: Keypair.random().publicKey(), shipment_id: SHIPMENT })
    ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_NOT_INITIALIZED });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('is skipped entirely when disabled', async () => {
    const { adapter, invoke } = makeAdapter({
      preflight: { enabled: false, checks: ['initialized'] },
      stateReader: reader,
    });
    invoke.mockResolvedValueOnce({ txHash: H1, ledger: 5 });

    await adapter.anchorEvent(anchorInput());

    expect(reader.isInitialized).not.toHaveBeenCalled();
  });

  it('a repeated idempotent event skips preflight and the chain entirely', async () => {
    const { adapter, invoke } = makeAdapter({
      preflight: enabledChecks(['initialized']),
      stateReader: reader,
    });
    invoke.mockResolvedValue({ txHash: H1, ledger: 5 });
    const options = { eventType: 'anchor', eventCounter: 7 };

    await adapter.anchorEvent(anchorInput(), options);
    await adapter.anchorEvent(anchorInput(), options);

    expect(reader.isInitialized).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
