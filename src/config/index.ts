import { env } from '../env.js';

const allowedOrigins = env.ALLOWED_ORIGINS.split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  stellarSecretKey: env.STELLAR_SECRET_KEY,
  stellarNetwork: env.STELLAR_NETWORK,
  allowedOrigins,
  redisUrl: env.REDIS_URL,
  corsOrigin: env.CORS_ORIGIN,
} as const;
