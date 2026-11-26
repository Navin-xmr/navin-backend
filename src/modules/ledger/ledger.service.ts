import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import * as ledgerRepo from './ledger.repo.js';
import type { LedgerBlockInput } from './ledger.repo.js';
import { MilestoneEvent } from '../../shared/types/shipment.js';
import { logger } from '../../shared/logger/logger.js';
import { config } from '../../config/index.js';
import { getChainAdapter } from '../../services/chain/factory.js';
import type {
  ReadContractVersionResult,
  ReadEscrowBalanceResult,
  ReadShipmentStatusResult,
} from '../../services/chain/types.js';
import {
  chainReadCacheKey,
  invalidateChainReadCache,
  invalidateChainReadCachePrefix,
  readChainReadCache,
  writeChainReadCache,
} from './ledger.cache.js';

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

/**
 * Verification bundle v2 (#1046): everything a client needs to independently verify a block.
 * Every field is read from what was persisted when the block was written; nothing is
 * rebuilt from mutable shipment/payment state.
 */
export interface LedgerVerificationBundle {
  /** Exact object hashed into `dataHash`; null for legacy blocks that never persisted it. */
  canonicalPayload: Record<string, unknown> | null;
  /** Lowercase-hex SHA-256 of the canonical payload; null for legacy blocks. */
  dataHash: string | null;
  txHash: string | null;
  /** Alias of `txHash` (kept for backwards compatibility). */
  transactionHash: string | null;
  ledger: number;
  /** `testnet` | `public` — recorded at write time, falling back to the configured network. */
  network: 'testnet' | 'public';
  /** Contract the tx targeted: persisted value, else indexed event metadata, else configured contract. */
  contractId: string | null;
  /** Canonical payload layout version, read from the payload's own `v` (it is hashed); null without a payload. */
  schemaVersion: number | null;
  /** Client `Idempotency-Key` of the originating request; null when none was supplied. */
  idempotencyKey: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function getLedgerBlockVerificationService(
  id: string
): Promise<LedgerVerificationBundle> {
  const block = await getLedgerBlockByIdService(id);
  const stored = block as unknown as {
    canonicalPayload?: unknown;
    network?: 'testnet' | 'public';
    contractId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  };

  let canonicalPayload: Record<string, unknown> | null = null;
  let schemaVersion: number | null = null;
  if (stored.canonicalPayload !== undefined && stored.canonicalPayload !== null) {
    const version = isPlainObject(stored.canonicalPayload) ? stored.canonicalPayload.v : undefined;
    if (
      !isPlainObject(stored.canonicalPayload) ||
      !Number.isInteger(version) ||
      (version as number) < 1
    ) {
      // Surface corruption instead of serving bytes a verifier cannot interpret.
      throw new AppError(
        422,
        'Stored canonical payload is malformed and cannot be verified',
        ErrorCodes.LEDGER_PAYLOAD_INVALID
      );
    }
    canonicalPayload = stored.canonicalPayload;
    schemaVersion = version as number;
  }

  return {
    canonicalPayload,
    dataHash: block.dataHash ?? null,
    txHash: block.transactionHash ?? null,
    transactionHash: block.transactionHash ?? null,
    ledger: block.ledger,
    network: stored.network ?? config.stellarNetwork,
    contractId:
      stringOrNull(stored.contractId) ??
      stringOrNull(stored.metadata?.contractId) ??
      stringOrNull(config.escrowContractId),
    schemaVersion,
    idempotencyKey: stringOrNull(stored.idempotencyKey),
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

  if (!adapter.readEscrowBalance) {
    throw new AppError(
      501,
      'Chain adapter does not support escrow balance reads',
      ErrorCodes.CHAIN_UNKNOWN
    );
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

  if (!adapter.readShipmentStatus) {
    throw new AppError(
      501,
      'Chain adapter does not support shipment status reads',
      ErrorCodes.CHAIN_UNKNOWN
    );
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
  if (!adapter.readEscrowBalance || !adapter.readShipmentStatus) {
    throw new AppError(
      501,
      'Chain adapter does not support settlement record reads',
      ErrorCodes.CHAIN_UNKNOWN
    );
  }
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

  if (!adapter.readContractVersion) {
    throw new AppError(
      501,
      'Chain adapter does not support contract version reads',
      ErrorCodes.CHAIN_UNKNOWN
    );
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
