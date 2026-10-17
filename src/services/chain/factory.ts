/**
 * Config-selected ChainAdapter factory (TODO J3 · P6-05).
 *
 * Domain call sites depend on `getChainAdapter()` + the port types in ./types.ts
 * only — never on an implementation. `SOROBAN_ADAPTER` picks the implementation:
 *
 * | SOROBAN_ADAPTER       | Adapter          | Notes                                        |
 * |-----------------------|------------------|----------------------------------------------|
 * | `simulated` (default) | SimulatedAdapter | Horizon manage-data; results `simulated: true` |
 * | `soroban`             | SorobanAdapter   | Live Soroban RPC contract invocation           |
 */
import { Keypair } from '@stellar/stellar-sdk';

import { config } from '../../config/index.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

import { SimulatedAdapter } from './simulated.adapter.js';
import { SorobanAdapter } from './soroban.adapter.js';
import type { ChainAdapter } from './types.js';

export type ChainAdapterKind = typeof config.chainAdapter;

export function createChainAdapter(kind: ChainAdapterKind = config.chainAdapter): ChainAdapter {
  switch (kind) {
    case 'simulated':
      return new SimulatedAdapter();
    case 'soroban':
      return new SorobanAdapter();
    default: {
      const unsupported: never = kind;
      throw new AppError(
        500,
        `Unsupported SOROBAN_ADAPTER: ${String(unsupported)}`,
        ErrorCodes.CHAIN_UNKNOWN
      );
    }
  }
}

let instance: ChainAdapter | undefined;

/** Process-wide adapter, created on first use from config. */
export function getChainAdapter(): ChainAdapter {
  instance ??= createChainAdapter();
  return instance;
}

/** Test seam: drop the memoized adapter so the next call re-reads config. */
export function resetChainAdapter(): void {
  instance = undefined;
}

/** Address the backend signs chain calls as — the spec `actor` for backend-originated anchors. */
export function getChainActorAddress(): string {
  if (!config.stellarSecretKey) {
    throw new AppError(500, 'STELLAR_SECRET_KEY is not configured', ErrorCodes.CHAIN_UNKNOWN);
  }
  return Keypair.fromSecret(config.stellarSecretKey).publicKey();
}
