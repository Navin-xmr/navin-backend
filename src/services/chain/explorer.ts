import { config } from '../../config/index.js';

/**
 * Block-explorer link for a transaction hash on the configured network.
 * Pure URL formatting; it never touches the chain, so it lives beside the
 * ChainAdapter port rather than in an adapter.
 */
export function getStellarExplorerUrl(txHash: string): string {
  const network = config.stellarNetwork === 'public' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}
