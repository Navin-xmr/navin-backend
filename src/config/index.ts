import { env } from '../env.js';
import { resolveContractRegistry } from './contractRegistry.js';
import { resolveStellarUrls } from './stellarNetwork.js';

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
  sorobanRpcUrl: stellarUrls.sorobanRpcUrl,
  escrowContractId: env.ESCROW_CONTRACT_ID ?? contracts.contracts.shipment.id,
  contractRegistry: contracts,
  chainAdapter: env.SOROBAN_ADAPTER,
  /** #1058 — ledgers required before an anchored event is marked verified. */
  chainConfirmations: {
    testnet: env.CHAIN_CONFIRMATIONS_TESTNET,
    public: env.CHAIN_CONFIRMATIONS_PUBLIC,
  },
  sentryDsn: env.SENTRY_DSN,
  totpEncryptionKey: env.TOTP_ENCRYPTION_KEY,
} as const;
