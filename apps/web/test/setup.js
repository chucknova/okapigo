/**
 * Shared set-up for the screen tests.
 *
 * More patience than the defaults (1 s per findBy…, 5 s per test). `pnpm test` runs every
 * package at once, and while the database suites run the screen tests can take a few seconds
 * to render, which made DIFFERENT tests time out on each full run (stage 12f). A thing that
 * never appears still fails, just after 4 s instead of 1 s.
 */
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 4_000 });
