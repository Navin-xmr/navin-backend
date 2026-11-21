import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import * as ledgerRepo from './ledger.repo.js';
import type { LedgerBlockInput } from './ledger.repo.js';
import { MilestoneEvent } from '../../shared/types/shipment.js';
import { logger } from '../../shared/logger/logger.js';
import { config } from '../../config/index.js';

export async function createLedgerBlockService(input: LedgerBlockInput) {
  const block = await ledgerRepo.createLedgerBlock(input);
  logger.info(
    { blockId: block._id, shipmentId: input.shipmentId, milestoneEvent: block.milestoneEvent },
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

export async function getLedgerBlockVerificationService(id: string) {
  const block = await getLedgerBlockByIdService(id);
  return {
    canonicalPayload: (block as unknown as { canonicalPayload?: unknown }).canonicalPayload ?? null,
    dataHash: block.dataHash ?? null,
    txHash: block.transactionHash ?? null,
    transactionHash: block.transactionHash ?? null,
    ledger: block.ledger,
    network: config.stellarNetwork,
  };
}

// ─── Chain read services (P14-12) ───

/**
 * Read the on-chain escrow balance for a payment.
 * Results are cached with a short TTL and invalidated on escrow events.
 */
export async function getEscrowBalanceService(
  paymentId: string,
  adapter = getChainAdapter()
): Promise<ReadEscrowBalanceResult> {
  const cacheKey = chainReadCacheKey('escrow-balance', paymentId);

  const cached = await readChainReadCache<ReadEscrowBalanceResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await adapter.readEscrowBalance({ payment_id: paymentId });
  await writeChainReadCache(cacheKey, result);
  return result;
}

/**
 * Read the on-chain shipment status for a shipment.
 * Results are cached with a short TTL and invalidated on escrow events.
 */
export async function getShipmentStatusService(
  shipmentId: string,
  adapter = getChainAdapter()
): Promise<ReadShipmentStatusResult> {
  const cacheKey = chainReadCacheKey('shipment-status', shipmentId);

  const cached = await readChainReadCache<ReadShipmentStatusResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await adapter.readShipmentStatus({ shipment_id: shipmentId });
  await writeChainReadCache(cacheKey, result);
  return result;
}

/**
 * Read the settlement record for a payment.
 * Combines the DB payment record with the on-chain escrow balance.
 */
export async function getSettlementRecordService(
  paymentId: string,
  adapter = getChainAdapter()
): Promise<{
  paymentId: string;
  escrowBalance: ReadEscrowBalanceResult;
  shipmentStatus: ReadShipmentStatusResult;
}> {
  const [escrowBalance, shipmentStatus] = await Promise.all([
    adapter.readEscrowBalance({ payment_id: paymentId }),
    adapter.readShipmentStatus({ shipment_id: paymentId }),
  ]);

  return {
    paymentId,
    escrowBalance,
    shipmentStatus,
  };
}

/**
 * Read the contract / spec version.
 * Results are cached with a short TTL.
 */
export async function getContractVersionService(
  adapter = getChainAdapter()
): Promise<ReadContractVersionResult> {
  const cacheKey = chainReadCacheKey('contract-version');

  const cached = await readChainReadCache<ReadContractVersionResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await adapter.readContractVersion();
  await writeChainReadCache(cacheKey, result);
  return result;
}

/**
 * Invalidate chain read caches after a state-changing on-chain event.
 * Call this from the indexer / event handler when escrow state changes.
 */
export async function invalidateChainReadCaches(event: {
  paymentId?: string;
  shipmentId?: string;
}): Promise<void> {
  if (event.paymentId) {
    await invalidateChainReadCache('escrow-balance', event.paymentId);
    await invalidateChainReadCache('settlement-record', event.paymentId);
  }
  if (event.shipmentId) {
    await invalidateChainReadCache('shipment-status', event.shipmentId);
  }
  await invalidateChainReadCachePrefix('contract-version');
}
