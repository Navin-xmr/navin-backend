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
