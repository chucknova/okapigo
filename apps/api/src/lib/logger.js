// @ts-check
/**
 * logger.js — creates the app's structured logger (pino).
 *
 * "Structured" means each log line is JSON ({"level":30,"msg":"...","reqId":"..."}),
 * not free text. Log services can then search and filter by field, e.g. "all errors
 * for request abc123". The PRD asks for structured logs under Observability.
 *
 * In development we pipe through pino-pretty so you get readable, coloured lines instead.
 */
import { pino } from 'pino';

/**
 * @param {{ level: string, pretty: boolean }} options
 */
export function createLogger({ level, pretty }) {
  return pino({
    level,
    // Never write secrets to logs, even by accident (e.g. logging a whole request).
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.otp'],
    ...(pretty && {
      transport: {
        target: 'pino-pretty',
        // SYS: = show timestamps in your local time zone rather than UTC.
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
      },
    }),
  });
}
