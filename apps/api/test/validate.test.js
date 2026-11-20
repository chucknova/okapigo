/**
 * The validate() middleware (16c: query strings too). A route gets the CHECKED values, with
 * their defaults and conversions, never the raw text.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate } from '../src/middleware/validate.js';

/** Runs the middleware on a fake request; returns it, or the error it threw. @param {any} schemas @param {any} req */
function run(schemas, req) {
  let passed = false;
  try {
    validate(schemas)(req, /** @type {any} */ ({}), () => {
      passed = true;
    });
  } catch (err) {
    return { err };
  }
  return { req, passed };
}

describe('validate: query strings', () => {
  const Query = z.object({
    filter: z.enum(['today', 'all']).default('today'),
    page: z.coerce.number().int().min(1).default(1),
    q: z.string().trim().default(''),
  });

  it('the route sees the checked values: defaults filled, numbers made numbers, text trimmed', () => {
    const { req, passed } = run({ query: Query }, { query: { page: '3', q: '  ojo ' } });
    expect(passed).toBe(true);
    expect(req.query).toEqual({ filter: 'today', page: 3, q: 'ojo' });
  });

  it('a value it doesn’t know: 400, saying which', () => {
    const { err } = run({ query: Query }, { query: { filter: 'soon' } });
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(err.details.issues[0].path).toBe('filter');
  });
});
