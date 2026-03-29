import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGO_URI: z
    .string()
    .min(1, 'MONGO_URI is required')
    .regex(/^mongodb(\+srv)?:\/\/.+$/, 'MONGO_URI must start with mongodb:// or mongodb+srv://'),
  JWT_SECRET: z.string().trim().min(32, 'JWT_SECRET must be at least 32 characters long'),
  STELLAR_SECRET_KEY: z
    .string()
    .trim()
    .regex(/^S[A-Z2-7]{20,}$/, 'STELLAR_SECRET_KEY must be a valid Stellar secret key')
    .optional(),
  STELLAR_NETWORK: z.enum(['testnet', 'public']).default('testnet'),
  REDIS_URL: z
    .string()
    .url('REDIS_URL must be a valid URL')
    .refine(value => value.startsWith('redis://') || value.startsWith('rediss://'), {
      message: 'REDIS_URL must start with redis:// or rediss://',
    })
    .default('redis://127.0.0.1:6379'),
});

const parsedEnv = EnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsedEnv.error.issues) {
    const key = issue.path.join('.') || 'ENV';
    console.error(`- ${key}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsedEnv.data;
