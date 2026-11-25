import { config } from '../../config/index.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { logger } from '../../shared/logger/logger.js';
import type { StellarNetwork } from '../../config/stellarNetwork.js';

export interface SorobanResourceUsage {
  resourceFee: string;
  cpuInstructions: number;
  ledgerBytes: number;
}

let budgetRejectionCount = 0;

/**
 * Rejects simulated submissions that exceed configured Soroban resource ceilings.
 *
 * @param usage - Minimum fee and resources returned by Soroban simulation.
 * @param network - Stellar network the transaction will be submitted to.
 * @throws {AppError} 503 ERR_CHAIN_FEE_BUDGET_EXCEEDED when any ceiling is exceeded.
 */
export function enforceSorobanResourceBudget(
  usage: SorobanResourceUsage,
  network: StellarNetwork
): void {
  const fee = BigInt(usage.resourceFee);
  const maxFee = config.sorobanFeePolicy.maxResourceFeeByNetwork[network];
  const exceeded = {
    resourceFee: fee > BigInt(maxFee),
    cpuInstructions: usage.cpuInstructions > config.sorobanFeePolicy.maxCpuInstructions,
    ledgerBytes: usage.ledgerBytes > config.sorobanFeePolicy.maxLedgerBytes,
  };
  const reasons = Object.entries(exceeded)
    .filter(([, overBudget]) => overBudget)
    .map(([resource]) => resource);

  if (reasons.length === 0) return;

  budgetRejectionCount += 1;
  logger.warn(
    {
      metric: 'soroban_submission_over_budget_total',
      network,
      reasons,
      resourceFee: usage.resourceFee,
      cpuInstructions: usage.cpuInstructions,
      ledgerBytes: usage.ledgerBytes,
    },
    'Soroban submission deferred because it exceeds the configured resource budget'
  );
  throw new AppError(
    503,
    'Soroban transaction exceeds the configured resource budget',
    ErrorCodes.CHAIN_FEE_BUDGET_EXCEEDED,
    { network, reasons }
  );
}

/** Returns the process-local over-budget counter for operational diagnostics. */
export function getSorobanBudgetRejectionCount(): number {
  return budgetRejectionCount;
}
