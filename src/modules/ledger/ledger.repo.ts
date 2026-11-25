import { Types } from 'mongoose';
import { LedgerBlock, type ILedgerBlock } from './ledger.model.js';
import { MilestoneEvent } from '../../shared/types/shipment.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { paginateCursor } from '../../shared/utils/pagination.js';
import { config } from '../../config/index.js';

export interface LedgerBlockInput {
  shipmentId: string | Types.ObjectId;
  /**
   * Canonical event field.  Callers should always supply this; the legacy
   * `eventType` alias is accepted for backwards compatibility during the
   * transition window and is treated as a synonym.
   */
  milestoneEvent?: MilestoneEvent;
  /** @deprecated Use milestoneEvent.  Accepted but not persisted separately. */
  eventType?: MilestoneEvent;
  blockNumber?: number;
  timestamp?: Date;
  shipmentReference?: string;
  /** SHA-256 hex digest of the payload committed by the on-chain transaction. */
  dataHash?: string;
  /** Exact payload hashed into dataHash. Persisted alongside every dataHash. */
  canonicalPayload?: Record<string, unknown>;
  /** #994 — defaults to 1 for legacy v1 events. */
  schemaVersion?: number;
  /** #994 — defaults to 0 for legacy v1 events. */
  eventCounter?: number;
  /** #994 — contract event topic name. */
  eventTopic?: string;
  transactionHash?: string;
  /** Overrides the network recorded for the block; defaults to the configured network. */
  network?: 'testnet' | 'public';
  /** Contract the transaction targeted; defaults to the configured escrow contract. */
  contractId?: string;
  /** Client `Idempotency-Key` / stable dedupe key for a replayed v2 event. */
  idempotencyKey?: string;
  ledger?: number;
  /** #1058 — confirmation depth; defaults to 0 until the head advances. */
  confirmations?: number;
  verified?: boolean;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export async function createLedgerBlock(input: LedgerBlockInput): Promise<ILedgerBlock> {
  // milestoneEvent is canonical; accept legacy eventType as a synonym.
  const milestoneEvent = input.milestoneEvent ?? input.eventType;
  if (!milestoneEvent) {
    throw new AppError(400, 'milestoneEvent or eventType is required', ErrorCodes.BAD_REQUEST);
  }

  return LedgerBlock.create({
    blockNumber: input.blockNumber ?? 0,
    timestamp: input.timestamp ?? new Date(),
    shipmentId: new Types.ObjectId(input.shipmentId),
    shipmentReference: input.shipmentReference,
    milestoneEvent,
    ...(input.transactionHash && { transactionHash: input.transactionHash }),
    ...(input.dataHash && { dataHash: input.dataHash }),
    ...(input.canonicalPayload && { canonicalPayload: input.canonicalPayload }),
    schemaVersion: input.schemaVersion ?? 1,
    eventCounter: input.eventCounter ?? 0,
    network: input.network ?? config.stellarNetwork,
    ...((input.contractId ?? config.escrowContractId) && {
      contractId: input.contractId ?? config.escrowContractId,
    }),
    ...(input.idempotencyKey && { idempotencyKey: input.idempotencyKey }),
    ...(input.eventTopic && { eventTopic: input.eventTopic }),
    ledger: input.ledger ?? input.blockNumber ?? 0,
    confirmations: input.confirmations ?? 0,
    verified: input.verified ?? false,
    ...(input.actor && { actor: input.actor }),
    ...(input.metadata && { metadata: input.metadata }),
  });
}

export interface LedgerBlocksPage {
  data: ILedgerBlock[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export async function getLedgerBlocks(filters?: {
  shipmentId?: string;
  milestoneEvent?: MilestoneEvent;
  limit?: number;
  cursor?: string;
}): Promise<LedgerBlocksPage> {
  const limit = filters?.limit ?? 20;
  const query: Record<string, unknown> = {};

  if (filters?.shipmentId) {
    query.shipmentId = new Types.ObjectId(filters.shipmentId);
  }

  if (filters?.milestoneEvent) {
    query.milestoneEvent = filters.milestoneEvent;
  }

  if (filters?.cursor) {
    query._id = { $lt: new Types.ObjectId(filters.cursor) };
  }

  const [data, total] = await Promise.all([
    LedgerBlock.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    LedgerBlock.countDocuments({
      ...(filters?.shipmentId ? { shipmentId: new Types.ObjectId(filters.shipmentId) } : {}),
      ...(filters?.milestoneEvent ? { milestoneEvent: filters.milestoneEvent } : {}),
    }),
  ]);

  const page = paginateCursor(data, limit);
  return {
    data: page.data,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    total,
  };
}

export async function getLedgerBlockById(id: string): Promise<ILedgerBlock | null> {
  return LedgerBlock.findById(id).lean();
}
