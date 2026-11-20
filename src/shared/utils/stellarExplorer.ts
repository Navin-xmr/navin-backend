import { config } from '../../config/index.js';

/**
 * Builds the Stellar Expert transaction URL for the configured network.
 *
 * @param txHash - Stellar transaction hash.
 * @returns The transaction URL on Stellar Expert.
 */
export function getStellarExplorerUrl(txHash: string): string {
  const network = config.stellarNetwork === 'public' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}
