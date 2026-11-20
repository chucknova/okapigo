// @ts-check
/**
 * validate.js — checks request input against a Zod schema before the route handler runs.
 *
 *   router.post('/roles', validate({ body: CreateRoleSchema }), handler)
 *
 * On success, the PARSED value replaces the raw one, so handlers see trimmed, normalised,
 * correctly-typed data (e.g. `contact` becomes { channel, destination }). On failure the
 * request stops here with a 400 listing every problem, and the handler never runs.
 *
 * The PRD requires "Zod validation on every API input". This is how.
 */
import { z } from 'zod';
import { HttpError } from './errors.js';

/** Route params that are database IDs. A malformed id can't exist, so it's a 404. */
export const IdParamsSchema = z.object({ id: z.uuid() });

/**
 * @param {{ body?: z.ZodType, params?: z.ZodType, query?: z.ZodType }} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return (req, _res, next) => {
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      req.params = /** @type {any} */ (result.data);
    }

    if (schemas.body) {
      // Express 5 leaves req.body undefined when no body was sent; treat that as {}.
      const result = schemas.body.safeParse(req.body ?? {});
      if (!result.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
          // e.g. [{ path: 'contact', message: 'Enter a valid email or phone number' }]
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      req.body = result.data;
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query ?? {});
      if (!result.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      // Express 5's req.query is a getter: replace it with the checked values (and defaults).
      Object.defineProperty(req, 'query', { value: result.data, writable: true });
    }

    next();
  };
}
