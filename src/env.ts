import { logger } from './shared/logger/logger.js';
import { envSchema } from './env.schema.js';

export type { Env } from './env.schema.js';

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  logger.error('❌ Invalid environment variables:');
  parsedEnv.error.issues.forEach(issue => {
    const key = issue.path.join('.') || 'ENV';
    logger.error(`- ${key}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsedEnv.data;
