import { readFileSync } from 'node:fs';

/** Contract kinds tracked in the committed registry. */
export type ContractKind = 'shipment' | 'token' | 'nft';
export type RegistryNetwork = 'testnet' | 'public';

export interface RegistryContract {
  id: string;
  wasmHash: string;
}

export interface NetworkRegistry {
  sourceCommit: string;
  contracts: Record<ContractKind, RegistryContract>;
}

export interface ContractRegistry {
  version: number;
  networks: Record<RegistryNetwork, NetworkRegistry>;
}

const REGISTRY_PATH = new URL('../../config/contract-registry.json', import.meta.url);

/** Load the committed registry (synchronous so it can gate startup). */
export function loadContractRegistry(): ContractRegistry {
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as ContractRegistry;
}

/**
 * Resolve deployed contract IDs for `network` from the registry and verify any
 * configured IDs against it. Mismatches fail fast instead of silently talking
 * to an unregistered deployment.
 *
 * @throws {Error} When the network or a configured ID is not in the registry.
 */
export function resolveContractRegistry(
  network: string,
  configured: Partial<Record<ContractKind, string>> = {},
  options: { strict?: boolean } = {}
): NetworkRegistry {
  const registry = loadContractRegistry();
  const entry = registry.networks[network as RegistryNetwork];
  if (!entry) {
    throw new Error(`Unknown contract registry network "${network}" (expected testnet or public)`);
  }

  if (options.strict !== false) {
    for (const [kind, id] of Object.entries(configured)) {
      if (id && entry.contracts[kind as ContractKind]?.id !== id) {
        throw new Error(
          `Configured ${kind} contract ID ${id} does not match ${network} registry entry ` +
            `${entry.contracts[kind as ContractKind]?.id}; update config/contract-registry.json first`
        );
      }
    }
  }

  return entry;
}
