import { env } from '../env.js';

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  stellarSecretKey: env.STELLAR_SECRET_KEY,
  stellarNetwork: env.STELLAR_NETWORK,
} as const;
