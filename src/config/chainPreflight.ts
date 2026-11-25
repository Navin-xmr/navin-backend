/**
 * Preflight check names shared by env validation and the preflight runner
 * (#1081). Kept dependency-free so `env.schema.ts` can import it.
 */
export const CHAIN_PREFLIGHT_CHECKS = [
  'initialized',
  'roles',
  'whitelist',
  'suspension',
  'token_decimals',
] as const;

export type ChainPreflightCheck = (typeof CHAIN_PREFLIGHT_CHECKS)[number];

export const DEFAULT_CHAIN_PREFLIGHT_CHECKS = CHAIN_PREFLIGHT_CHECKS.join(',');

/** Decimals the escrow token must have (Stellar assets use 7). */
export const REQUIRED_TOKEN_DECIMALS = 7;

/**
 * Parse `CHAIN_PREFLIGHT_CHECKS` (comma list, e.g. `initialized,roles`).
 * Returns the unknown names so the caller can report them.
 */
export function parseChainPreflightChecks(value: string): {
  checks: ChainPreflightCheck[];
  unknown: string[];
} {
  const names = value
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0);
  const known = new Set<string>(CHAIN_PREFLIGHT_CHECKS);
  return {
    checks: [...new Set(names.filter(name => known.has(name)))] as ChainPreflightCheck[],
    unknown: names.filter(name => !known.has(name)),
  };
}
