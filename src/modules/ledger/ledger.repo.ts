import { Types } from 'mongoose';
import { LedgerBlock, type ILedgerBlock } from './ledger.model.js';
import { MilestoneEvent } from '../../shared/types/shipment.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { paginateCursor } from '../../shared/utils/pagination.js';

export interface LedgerBlockInput {
  shipmentId: string | Types.ObjectId;
  milestoneEvent?: MilestoneEvent;
  eventType?: MilestoneEvent;
  blockNumber?: number;
  timestamp?: Date;
  shipmentReference?: string;
  transactionHash?: string;
  ledger?: number;
  verified?: boolean;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export async function createLedgerBlock(input: LedgerBlockInput): Promise<ILedgerBlock> {
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
    eventType: input.eventType,
    ...(input.transactionHash && { transactionHash: input.transactionHash }),
    ledger: input.ledger ?? input.blockNumber ?? 0,
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
