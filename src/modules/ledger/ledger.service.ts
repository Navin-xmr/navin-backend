import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import * as ledgerRepo from './ledger.repo.js';
import type { LedgerBlockInput } from './ledger.repo.js';
import { MilestoneEvent } from '../../shared/types/shipment.js';
import { logger } from '../../shared/logger/logger.js';

export async function createLedgerBlockService(input: LedgerBlockInput) {
  const block = await ledgerRepo.createLedgerBlock(input);
  logger.info(
    { blockId: block._id, shipmentId: input.shipmentId, eventType: input.eventType },
    'Ledger block created'
  );
  return block;
}

export async function getLedgerBlocksService(params: {
  shipmentId?: string;
  milestoneEvent?: MilestoneEvent;
  limit: number;
  cursor?: string;
}) {
  return ledgerRepo.getLedgerBlocks(params);
}

export async function getLedgerBlockByIdService(id: string) {
  const block = await ledgerRepo.getLedgerBlockById(id);
  if (!block) {
    throw new AppError(404, 'Ledger block not found', ErrorCodes.LEDGER_BLOCK_NOT_FOUND);
  }
  return block;
}
