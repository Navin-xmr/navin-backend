import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
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
