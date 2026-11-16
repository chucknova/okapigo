// @ts-check
/**
 * The public face of @okapigo/db. Apps import from here:
 *   import { createPrismaClient, seedDemoOperator } from '@okapigo/db';
 */
export { createPrismaClient } from './client.js';
export { createOperatorWithPresetRoles } from './operators.js';
export {
  syncScheduleDepartures,
  extendAllSchedules,
  listAvailability,
  HORIZON_DAYS,
} from './departures.js';
export { createHold, releaseHold, expireDueHolds, HoldError } from './holds.js';
export { seedDemoOperator, DEFAULT_SLUG } from './seed/demo-operator.js';
