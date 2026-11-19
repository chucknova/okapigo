/**
 * Shared set-up for the operator app's screen tests.
 *
 * Patience: a full `pnpm test` runs every package at once (the database suites too), and on a
 * busy machine (load 25–45 seen in 15d) drawing a screen in jsdom can take seconds. A thing
 * that never appears still fails, just after 10 s instead of 1.
 */
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 10_000 });
