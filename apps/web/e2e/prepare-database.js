// @ts-check
/**
 * Before the browser tests: their own database (okapigo_e2e) is created if it's missing and
 * brought up to date with the migrations. A separate step (in the `e2e` script), because
 * Playwright starts the API before its global set-up runs, and the API needs the database.
 */
import { isolate, prepareDatabase } from '@okapigo/db/testing';

isolate('e2e');
prepareDatabase();
