import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
// pino-pretty spawns a worker thread per logger instance. Under Jest every
// test file builds its own module registry (and logger), so the transport
// would leak one thread — and its whole registry — per suite until the run
// OOMs. Tests log plain JSON to stdout instead (no assertions read it).
const isTest = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';

/**
 * Process-wide structured logger.
 *
 * Import it by name — `import { logger } from '.../logger/logger.js'` — which is
 * what every other module in `src/` does. There is intentionally no default
 * export: AGENTS.md §3 requires one declaration per name per file, and a second
 * (default) binding for the same singleton only splits call sites across two
 * import styles.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: isProd
    ? {
        paths: [
          'req.headers.authorization',
          'req.body.password',
          'req.body.token',
          'password',
          'token',
          'secret',
          'stack',
        ],
        remove: true,
      }
    : undefined,
  transport:
    isProd || isTest
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
});
