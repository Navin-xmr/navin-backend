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

const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');

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

  const network =
    config.stellarNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET;

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: network,
  })
    .addOperation(
      Operation.manageData({
        name: `tracking:${shipmentData.shipmentId}`,
        value: shipmentData.trackingNumber,
      }),
    )
    .addOperation(
      Operation.manageData({
        name: `route:${shipmentData.shipmentId}`,
        value: `${shipmentData.origin}->${shipmentData.destination}`,
      }),
    )
    .setTimeout(30)
    .build();

  transaction.sign(keypair);

  const result = await horizon.submitTransaction(transaction);
  const txHash = result.hash;
  const stellarTokenId = `stellar:${shipmentData.shipmentId}:${txHash.slice(0, 8)}`;

  return { stellarTokenId, stellarTxHash: txHash };
}

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

  const network =
    config.stellarNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET;

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
      }),
    )
    .addMemo(Memo.hash(Buffer.from(telemetryData.dataHash, 'hex')))
    .setTimeout(30)
    .build();

  transaction.sign(keypair);

  const result = await horizon.submitTransaction(transaction);
  const txHash = result.hash;

  return { stellarTxHash: txHash };
}
