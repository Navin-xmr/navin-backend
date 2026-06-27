import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Memo,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { config } from '../config/index.js';
import { logger } from '../shared/logger/logger.js';

const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');

/**
 * Creates a Stellar manage-data transaction for a shipment and returns token metadata.
 * @param {{trackingNumber: string; origin: string; destination: string; shipmentId: string}} shipmentData - Shipment data used to build the Stellar transaction.
 * @returns {Promise<{stellarTokenId: string; stellarTxHash: string}>} Generated Stellar token identifier and transaction hash.
 * @throws {Error} When Stellar secret key configuration is missing.
 */
export async function tokenizeShipment(shipmentData: {
  trackingNumber: string;
  origin: string;
  destination: string;
  shipmentId: string;
}): Promise<{ stellarTokenId: string; stellarTxHash: string }> {
  const secretKey = config.stellarSecretKey;
  if (!secretKey) {
    throw new Error('STELLAR_SECRET_KEY is not configured');
  }

  const keypair = Keypair.fromSecret(secretKey);
  const account = await horizon.loadAccount(keypair.publicKey());

  const network = config.stellarNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET;

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: network,
  })
    .addOperation(
      Operation.manageData({
        name: `tracking:${shipmentData.shipmentId}`,
        value: shipmentData.trackingNumber,
      })
    )
    .addOperation(
      Operation.manageData({
        name: `route:${shipmentData.shipmentId}`,
        value: `${shipmentData.origin}->${shipmentData.destination}`,
      })
    )
    .setTimeout(30)
    .build();

  transaction.sign(keypair);

  const result = await horizon.submitTransaction(transaction);
  const txHash = result.hash;
  const stellarTokenId = `stellar:${shipmentData.shipmentId}:${txHash.slice(0, 8)}`;

  return { stellarTokenId, stellarTxHash: txHash };
}

/**
 * Anchors a telemetry hash on Stellar using manage-data and memo fields.
 * @param {{shipmentId: string; dataHash: string}} telemetryData - Telemetry anchor payload.
 * @returns {Promise<{stellarTxHash: string}>} Stellar transaction hash for the anchor.
 * @throws {Error} When Stellar configuration is missing or dataHash is invalid.
 */
export async function anchorTelemetryHash(telemetryData: {
  shipmentId: string;
  dataHash: string;
}): Promise<{ stellarTxHash: string }> {
  const secretKey = config.stellarSecretKey;
  if (!secretKey) {
    throw new Error('STELLAR_SECRET_KEY is not configured');
  }

  if (!telemetryData.dataHash || typeof telemetryData.dataHash !== 'string') {
    throw new Error('dataHash must be a non-empty string');
  }

  const keypair = Keypair.fromSecret(secretKey);
  const account = await horizon.loadAccount(keypair.publicKey());

  const network = config.stellarNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET;

  // We must include a Memo to embed the hash, and at least one operation
  // for the transaction to be valid.
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: network,
  })
    .addOperation(
      Operation.manageData({
        name: `telemetry:${telemetryData.shipmentId}`,
        value: telemetryData.dataHash,
      })
    )
    .addMemo(Memo.hash(Buffer.from(telemetryData.dataHash, 'hex')))
    .setTimeout(30)
    .build();

  transaction.sign(keypair);

  const result = await horizon.submitTransaction(transaction);
  const txHash = result.hash;

  return { stellarTxHash: txHash };
}
/**
 * Releases escrow on Stellar by recording a release event on-chain.
 * @param {{paymentId: string; shipmentId: string}} escrowData - Escrow release metadata.
 * @returns {Promise<{success: boolean; transactionHash?: string}>} Release status and optional transaction hash.
 */
export async function releaseEscrow(escrowData: {
  paymentId: string;
  shipmentId: string;
}): Promise<{ success: boolean; transactionHash?: string }> {
  try {
    const secretKey = config.stellarSecretKey;
    if (!secretKey) {
      throw new Error('STELLAR_SECRET_KEY is not configured');
    }

    const keypair = Keypair.fromSecret(secretKey);
    const account = await horizon.loadAccount(keypair.publicKey());

    const network = config.stellarNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET;

    // Build a transaction to release the escrow by recording the release event on-chain
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: network,
    })
      .addOperation(
        Operation.manageData({
          name: `release:${escrowData.paymentId}`,
          value: escrowData.shipmentId,
        })
      )
      .addMemo(Memo.text(`escrow-release:${escrowData.paymentId}`))
      .setTimeout(30)
      .build();

    transaction.sign(keypair);

    const result = await horizon.submitTransaction(transaction);
    const txHash = result.hash;

    return {
      success: true,
      transactionHash: txHash,
    };
  } catch (error) {
    logger.error({ err: error }, 'Error releasing escrow');
    return { success: false };
  }
}

export function getStellarExplorerUrl(txHash: string): string {
  const network = config.stellarNetwork === 'public' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}
