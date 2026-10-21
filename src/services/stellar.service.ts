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
import { AppError, ErrorCodes } from '../shared/http/errors.js';
import { getChainAdapter } from './chain/factory.js';
import { generateDataHash } from '../shared/utils/crypto.js';

export function getHorizonServer(url: string = config.horizonUrl): Horizon.Server {
  return new Horizon.Server(url);
}

/**
 * Creates a Stellar manage-data transaction for a shipment and returns token metadata.
 * @param {{trackingNumber: string; origin: string; destination: string; shipmentId: string}} shipmentData - Shipment data used to build the Stellar transaction.
 * @returns {Promise<{stellarTokenId: string; stellarTxHash: string}>} Generated Stellar token identifier and transaction hash.
 * @throws {AppError} When Stellar secret key configuration is missing.
 */
export async function tokenizeShipment(shipmentData: {
  trackingNumber: string;
  origin: string;
  destination: string;
  shipmentId: string;
}): Promise<{ stellarTokenId: string; stellarTxHash: string }> {
  const secretKey = config.stellarSecretKey;
  if (!secretKey) {
    throw new AppError(500, 'STELLAR_SECRET_KEY is not configured', ErrorCodes.STELLAR_CONFIG);
  }

  const horizon = getHorizonServer(config.horizonUrl);
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
 * @throws {AppError} When Stellar configuration is missing or dataHash is invalid.
 */
export async function anchorTelemetryHash(telemetryData: {
  shipmentId: string;
  dataHash: string;
}): Promise<{ stellarTxHash: string }> {
  const secretKey = config.stellarSecretKey;
  if (!secretKey) {
    throw new AppError(500, 'STELLAR_SECRET_KEY is not configured', ErrorCodes.STELLAR_CONFIG);
  }

  if (!telemetryData.dataHash || typeof telemetryData.dataHash !== 'string') {
    throw new AppError(400, 'dataHash must be a non-empty string', ErrorCodes.STELLAR_INVALID_HASH);
  }

  const horizon = getHorizonServer(config.horizonUrl);
  const keypair = Keypair.fromSecret(secretKey);
  const account = await horizon.loadAccount(keypair.publicKey());

  const network = config.stellarNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET;

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
 * Releases escrow on Stellar via ChainAdapter release_escrow call.
 * Rejects with AppError codes on failure (no error swallowing).
 */
export async function releaseEscrow(escrowData: {
  paymentId: string;
  shipmentId: string;
  proofHash?: string;
}): Promise<{ success: boolean; transactionHash?: string; simulated?: boolean }> {
  const adapter = getChainAdapter();
  const proofHash =
    escrowData.proofHash ??
    generateDataHash({ paymentId: escrowData.paymentId, shipmentId: escrowData.shipmentId });

  const result = await adapter.releaseEscrow({
    payment_id: escrowData.paymentId,
    proof_hash: proofHash,
  });

  return {
    success: true,
    transactionHash: result.txHash,
    simulated: result.simulated,
  };
}

export function getStellarExplorerUrl(txHash: string): string {
  const network = config.stellarNetwork === 'public' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}
