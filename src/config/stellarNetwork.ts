export type StellarNetwork = 'testnet' | 'public';

export interface StellarNetworkUrls {
  horizonUrl: string;
  sorobanRpcUrl: string;
}

const STELLAR_NETWORK_DEFAULTS: Record<StellarNetwork, StellarNetworkUrls> = {
  testnet: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  },
  public: {
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
  },
};

/**
 * Resolves the Horizon and Soroban RPC URLs for a Stellar network.
 *
 * Defaults derive from `network`; either can be overridden individually
 * (e.g. via HORIZON_URL / SOROBAN_RPC_URL env vars) without affecting the other.
 *
 * @throws {Error} When `network` isn't a known Stellar network.
 */
export function resolveStellarUrls(
  network: string,
  overrides: { horizonUrl?: string; sorobanRpcUrl?: string } = {}
): StellarNetworkUrls {
  const defaults = STELLAR_NETWORK_DEFAULTS[network as StellarNetwork];
  if (!defaults) {
    throw new Error(
      `Unknown STELLAR_NETWORK "${network}" — expected one of: ${Object.keys(STELLAR_NETWORK_DEFAULTS).join(', ')}`
    );
  }

  return {
    horizonUrl: overrides.horizonUrl ?? defaults.horizonUrl,
    sorobanRpcUrl: overrides.sorobanRpcUrl ?? defaults.sorobanRpcUrl,
  };
}
