import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  STELLAR_SECRET_KEY: z.string().optional(),
  STELLAR_NETWORK: z.string().default('testnet'),
});

export const env = EnvSchema.parse(process.env);
