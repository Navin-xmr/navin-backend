import { env } from '../env.js';
import { resolveContractRegistry } from './contractRegistry.js';
import { resolveSorobanConfig, resolveStellarUrls } from './stellarNetwork.js';

// P15-01: deployed contract IDs come from the committed registry. Any
// configured ID must match it (enforced outside tests, where fixtures are used).
const contracts = resolveContractRegistry(
  env.STELLAR_NETWORK,
  { shipment: env.ESCROW_CONTRACT_ID },
  { strict: env.NODE_ENV !== 'test' }
);

const allowedOrigins = env.ALLOWED_ORIGINS.split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Fails fast at startup if STELLAR_NETWORK is somehow neither 'testnet' nor 'public'
// (the zod enum in env.ts already guards this, but this keeps config.ts self-defending).
const stellarUrls = resolveStellarUrls(env.STELLAR_NETWORK, {
  horizonUrl: env.HORIZON_URL,
  sorobanRpcUrl: env.SOROBAN_RPC_URL,
});

// #995 — passphrase/RPC default per network; env overrides win. No contract id
// or RPC URL literals live outside this (config) layer.
const sorobanNetwork = resolveSorobanConfig(env.STELLAR_NETWORK, {
  rpcUrl: env.SOROBAN_RPC_URL,
  networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
});

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  jwtSecret: env.JWT_SECRET,
  stellarSecretKey: env.STELLAR_SECRET_KEY,
  stellarNetwork: env.STELLAR_NETWORK,
  horizonUrl: stellarUrls.horizonUrl,
  allowedOrigins,
  redisUrl: env.REDIS_URL,
  corsOrigin: env.CORS_ORIGIN,

  // SMTP (email)
  frontendUrl: env.FRONTEND_URL,
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  },
  sendgridApiKey: env.SENDGRID_API_KEY,
  twilio: {
    sid: env.TWILIO_SID,
    token: env.TWILIO_TOKEN,
    from: env.TWILIO_FROM,
  },
  storage: {
    provider: env.STORAGE_PROVIDER,
  },
  s3: {
    bucket: env.S3_BUCKET,
    endpoint: env.S3_ENDPOINT,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    region: env.S3_REGION,
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  sorobanRpcUrl: sorobanNetwork.rpcUrl,
  escrowContractId: env.ESCROW_CONTRACT_ID,
  contractRegistry: contracts,
  chainAdapter: env.SOROBAN_ADAPTER,
  /** #995 — network-derived signing passphrase, overridable via env. */
  sorobanNetworkPassphrase: sorobanNetwork.networkPassphrase,
  /** #995 — deployed contract ids; absent when not configured for this network. */
  shipmentContractId: env.SHIPMENT_CONTRACT_ID,
  tokenContractId: env.TOKEN_CONTRACT_ID,
  nftContractId: env.NFT_CONTRACT_ID,
  sorobanFeePolicy: {
    maxResourceFeeByNetwork: {
      testnet: env.SOROBAN_MAX_RESOURCE_FEE_TESTNET,
      public: env.SOROBAN_MAX_RESOURCE_FEE_PUBLIC,
    },
    maxCpuInstructions: env.SOROBAN_MAX_CPU_INSTRUCTIONS,
    maxLedgerBytes: env.SOROBAN_MAX_LEDGER_BYTES,
  },
  chainWebhookEncryptionKey: env.CHAIN_WEBHOOK_ENCRYPTION_KEY,
  chainPreflight: {
    enabled: env.CHAIN_PREFLIGHT_ENABLED,
    checks: env.CHAIN_PREFLIGHT_CHECKS,
  },
  chainSubmit: {
    maxAttempts: env.CHAIN_SUBMIT_MAX_ATTEMPTS,
    backoffMs: env.CHAIN_SUBMIT_BACKOFF_MS,
    backoffMaxMs: env.CHAIN_SUBMIT_BACKOFF_MAX_MS,
  },
  /** #1058 — ledgers required before an anchored event is marked verified. */
  chainConfirmations: {
    testnet: env.CHAIN_CONFIRMATIONS_TESTNET,
    public: env.CHAIN_CONFIRMATIONS_PUBLIC,
  },
  sentryDsn: env.SENTRY_DSN,
  metricsToken: env.METRICS_TOKEN,
  metricsPort: env.METRICS_PORT,
  totpEncryptionKey: env.TOTP_ENCRYPTION_KEY,
} as const;
