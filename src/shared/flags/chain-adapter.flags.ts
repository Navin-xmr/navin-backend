/**
 * Chain adapter feature flags for per-environment selection (#1064).
 *
 * Allows independent control of adapter selection per environment:
 * - dev/test: simulated (fast, no RPC credentials)
 * - staging/prod: soroban (live contract calls, full escrow semantics)
 *
 * With escrow hard-fail in soroban mode: never silently fall back to simulated
 * in production, as that would lose funds.
 *
 * Flag matrix:
 * | NODE_ENV    | SOROBAN_ADAPTER | Behavior |
 * |-------------|-----------------|----------|
 * | development | simulated       | default ✓ |
 * | development | soroban         | live RPC (if configured) |
 * | test        | simulated       | default ✓ |
 * | test        | soroban         | live RPC (if configured) |
 * | staging     | simulated       | allowed (for testing fallback) |
 * | staging     | soroban         | live RPC (recommended) |
 * | production  | simulated       | FORBIDDEN ✗ escrow must not silently fail |
 * | production  | soroban         | required — production must use live escrow |
 */

import { config } from '../../config/index.js';
import { logger } from '../logger/logger.js';

/**
 * Validates that the configured adapter is appropriate for the environment.
 *
 * Rules:
 * - Production forbids simulated (no silent escrow failures)
 * - All other environments allow either (but simulated is default)
 * - Logs warnings for non-prod overrides
 *
 * @throws {Error} if production is misconfigured with simulated adapter
 */
export function validateChainAdapterForEnvironment(options: { strict?: boolean } = {}): void {
  const strict = options.strict ?? true;
  const adapter = config.chainAdapter;
  const env: string = config.nodeEnv;

  if (env === 'production' && adapter === 'simulated') {
    const message = `FATAL: SOROBAN_ADAPTER=simulated in production. Escrow operations must use live Soroban contracts (SOROBAN_ADAPTER=soroban).`;
    logger.error(message);
    if (strict) {
      throw new Error(message);
    }
  }

  if (env !== 'production' && adapter === 'soroban') {
    logger.warn(
      { env, adapter },
      '[Flags] Non-production environment using soroban adapter (live RPC). Ensure SOROBAN_RPC_URL and ESCROW_CONTRACT_ID are configured.'
    );
  }

  if (env === 'staging' && adapter === 'simulated') {
    logger.warn(
      { env, adapter },
      '[Flags] Staging is using simulated adapter (no fund movement). Set SOROBAN_ADAPTER=soroban for live integration testing.'
    );
  }

  logger.info({ env, adapter }, '[Flags] Chain adapter configuration validated');
}

/**
 * Determine if escrow operations should hard-fail when the adapter cannot proceed.
 *
 * In production (soroban mode only), escrow MUST NOT silently fall back to simulated.
 * In non-prod, a warning + metric are sufficient (allows testing recovery flows).
 *
 * @returns true if escrow endpoints should hard-fail (production + soroban)
 */
export function shouldEscrowHardFail(): boolean {
  return config.nodeEnv === 'production' && config.chainAdapter === 'soroban';
}

/**
 * Log a loud warning + metric when fallback to simulated is triggered.
 *
 * Called when an escrow operation would silently fall back to simulated adapter.
 * In production, this is prevented by shouldEscrowHardFail(). In non-prod,
 * we emit a warning so operators know the fallback is active.
 *
 * @param context e.g., "releaseEscrow", "anchorEvent"
 * @param paymentId or shipmentId for audit trail
 */
export function emitEscrowFallbackWarning(context: string, id: string): void {
  logger.warn(
    { context, id, env: config.nodeEnv, adapter: config.chainAdapter },
    '[Flags] ⚠️ ESCROW FALLBACK: Operation fell back to simulated adapter. No on-chain state change.'
  );

  // TODO: emit a metric to monitoring system
  // e.g., counter('escrow.fallback', { env: config.nodeEnv, operation: context })
}
