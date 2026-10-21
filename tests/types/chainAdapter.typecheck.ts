/**
 * Type-level tests for the ChainAdapter port.
 * Not a Jest suite — compiled with the TS compiler by tests/chain.adapter.port.test.ts,
 * which fails on any diagnostic (incl. an unused `@ts-expect-error`).
 */
import { AppError, ErrorCodes } from '../../src/shared/http/errors.js';
import type {
  AnchorEventInput,
  AnchorResult,
  ChainAdapter,
  ChainErrorCode,
  ChainEventCursor,
  EscrowResult,
  ReleaseEscrowInput,
} from '../../src/services/chain/types.js';
import type { AnchorArgs, ChainEvent, ReleaseEscrowArgs } from '../../src/shared/types/chain.js';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(): T => true as T;

// ─── Port types are the spec types (no redefinition) ────────────────────────
assertType<Equals<AnchorEventInput, AnchorArgs>>();
assertType<Equals<ReleaseEscrowInput, ReleaseEscrowArgs>>();
assertType<Equals<ChainEventCursor, string>>();
assertType<Equals<Awaited<ReturnType<ChainAdapter['anchorEvent']>>, AnchorResult>>();
assertType<Equals<Awaited<ReturnType<ChainAdapter['releaseEscrow']>>, EscrowResult>>();
assertType<Equals<ReturnType<ChainAdapter['streamEvents']>, AsyncIterable<ChainEvent>>>();

// ─── Error codes are restricted to ERR_CHAIN_* ──────────────────────────────
const chainCode: ChainErrorCode = ErrorCodes.CHAIN_ESCROW_NOT_FOUND;
// @ts-expect-error — non-chain codes are not adapter error codes
const nonChainCode: ChainErrorCode = ErrorCodes.NOT_FOUND;
void chainCode;
void nonChainCode;

// ─── Mock adapter compiles against the port ─────────────────────────────────
const HASH = 'a'.repeat(64);

export class MockChainAdapter implements ChainAdapter {
  constructor(
    private readonly events: ChainEvent[] = [],
    private readonly escrows = new Set<string>()
  ) {}

  async anchorEvent(_input: AnchorEventInput): Promise<AnchorResult> {
    return { txHash: HASH, ledger: 1, simulated: true };
  }

  async releaseEscrow(input: ReleaseEscrowInput): Promise<EscrowResult> {
    if (!this.escrows.has(input.payment_id)) {
      const code: ChainErrorCode = ErrorCodes.CHAIN_ESCROW_NOT_FOUND;
      throw new AppError(404, 'Escrow not found', code);
    }
    return { txHash: HASH, ledger: 2, simulated: true, paymentId: input.payment_id };
  }

  async *streamEvents(cursor?: ChainEventCursor): AsyncIterable<ChainEvent> {
    const start = cursor ? this.events.findIndex(e => e.id === cursor) + 1 : 0;
    yield* this.events.slice(start);
  }
}

export const literalAdapter = {
  anchorEvent: async () => ({ txHash: HASH, ledger: 1, simulated: false }),
  releaseEscrow: async (i: ReleaseEscrowInput) => ({
    txHash: HASH,
    ledger: 1,
    simulated: false,
    paymentId: i.payment_id,
  }),
  async *streamEvents() {
    yield* [] as ChainEvent[];
  },
} satisfies ChainAdapter;

// ─── Contract violations are rejected ───────────────────────────────────────
export const silentFailure = {
  ...literalAdapter,
  // @ts-expect-error — the legacy `{ success: false }` shape is not an EscrowResult
  releaseEscrow: async () => ({ success: false }),
} satisfies ChainAdapter;

// @ts-expect-error — streamEvents is required
export const missingStream: ChainAdapter = {
  anchorEvent: literalAdapter.anchorEvent,
  releaseEscrow: literalAdapter.releaseEscrow,
};

export const untypedEvents = {
  ...literalAdapter,
  // @ts-expect-error — streamed items must be spec ChainEvents
  async *streamEvents() {
    yield { name: 'mint' };
  },
} satisfies ChainAdapter;

export async function misuse(adapter: ChainAdapter): Promise<void> {
  // @ts-expect-error — input must be the snake_case spec args (proof_hash required)
  await adapter.releaseEscrow({ payment_id: 'p1' });
  // @ts-expect-error — camelCase is not the spec shape
  await adapter.anchorEvent({ shipmentId: 's1', dataHash: HASH, actor: 'G' });
}

// ─── Domain-style consumer: events narrow by name ───────────────────────────
export async function consume(adapter: ChainAdapter, cursor?: ChainEventCursor): Promise<string[]> {
  const hashes: string[] = [];
  for await (const event of adapter.streamEvents(cursor)) {
    if (event.name === 'anchor') {
      const [dataHash] = event.data;
      assertType<Equals<(typeof event.data)[1], number>>();
      hashes.push(dataHash);
    }
  }
  const released = await adapter.releaseEscrow({ payment_id: 'p1', proof_hash: HASH });
  hashes.push(released.txHash);
  return hashes;
}
