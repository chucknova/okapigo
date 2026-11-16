/**
 * helpers.js — small building blocks shared by API tests.
 */
import { pino } from 'pino';

/** A logger that prints nothing, so test output only shows test results. */
export const silentLogger = pino({ level: 'silent' });

/** A fake database whose queries always succeed. */
export const healthyDb = { query: async () => ({ rows: [{ '?column?': 1 }] }) };

/** A fake Redis whose PING always succeeds. */
export const healthyRedis = { ping: async () => 'PONG' };

/** A fake dependency that fails, simulating "the database/Redis is down". */
export const failing = {
  query: async () => {
    throw new Error('connection refused');
  },
  ping: async () => {
    throw new Error('connection refused');
  },
};
