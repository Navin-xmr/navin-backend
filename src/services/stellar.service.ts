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
 * Releases escrow on Stellar via the ChainAdapter `release_escrow(caller, shipment_id)`
 * port (v2, #1056). Escrow is per-shipment; there is no proof hash to invent.
 * P12-12: Always goes through the contract - no simulated path for soroban mode.
 * Rejects with AppError codes on failure (no error swallowing, no `{success:false}`).
 */
export async function releaseEscrow(escrowData: {
  caller: string;
  shipmentId: string;
}): Promise<{ txHash: string; ledger: number; simulated: boolean }> {
  const result = await getChainAdapter().releaseEscrow({
    caller: escrowData.caller,
    shipment_id: escrowData.shipmentId,
  });

  // P12-12: In soroban mode, txHash must be present - no success without tx hash
  if (!result.txHash) {
    throw new AppError(
      500,
      'Release submitted but no transaction hash returned',
      ErrorCodes.CHAIN_UNKNOWN
    );
  }

  return {
    txHash: result.txHash,
    ledger: result.ledger,
    simulated: result.simulated,
  };
}

export function getStellarExplorerUrl(txHash: string): string {
  const network = config.stellarNetwork === 'public' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

/**
 * Confirms delivery and releases escrow via the contract's `confirm_delivery` function (P12-12).
 * This co-emits both `delivery_confirmed` and `escrow_released` events.
 * Partial vs full release semantics:
 * - Full release: entire escrow balance released to payee
 * - Partial release: only specified amount released (remainder stays in escrow)
 * Returns the transaction hash only after on-chain confirmation.
 *
 * @param input.confirmDelivery Data: receiver address, shipment_id, amount (optional for partial)
 * @returns Confirmed transaction receipt with txHash and ledger
 * @throws {AppError} On contract rejection, timeout, or missing tx hash
 */
export async function confirmDeliveryAndRelease(input: {
  receiver: string;
  shipmentId: string;
  amount?: string; // Optional: omit for full release, specify for partial
  idempotencyKey?: string;
}): Promise<{ txHash: string; ledger: number; simulated: boolean }> {
  const adapter = getChainAdapter();

  // Use the adapter's confirmDelivery method if available (soroban mode)
  if ('confirmDelivery' in adapter && typeof adapter.confirmDelivery === 'function') {
    const result = await adapter.confirmDelivery({
      receiver: input.receiver,
      shipment_id: input.shipmentId,
      amount: input.amount,
      idempotency_key: input.idempotencyKey,
    });

    // P12-12: No code path reports success without a tx hash in soroban mode
    if (!result.txHash) {
      throw new AppError(
        500,
        'Delivery confirmation submitted but no transaction hash returned',
        ErrorCodes.CHAIN_UNKNOWN
      );
    }

    return {
      txHash: result.txHash,
      ledger: result.ledger,
      simulated: result.simulated,
    };
  }

  // Fallback: call release_escrow directly for simulated mode
  const result = await adapter.releaseEscrow({
    caller: input.receiver,
    shipment_id: input.shipmentId,
  });

  if (!result.txHash) {
    throw new AppError(
      500,
      'Escrow release submitted but no transaction hash returned',
      ErrorCodes.CHAIN_UNKNOWN
    );
  }

  return {
    txHash: result.txHash,
    ledger: result.ledger,
    simulated: result.simulated,
  };
}
