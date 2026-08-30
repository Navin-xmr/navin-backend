import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

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
  transport: isProd
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

export default logger;
