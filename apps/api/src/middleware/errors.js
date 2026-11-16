// @ts-check
/**
 * errors.js — what the API does when something goes wrong.
 *
 * Every error leaves the API in the same JSON shape:
 *   { "error": { "code": "NOT_FOUND", "message": "..." } }
 * so the guest web, the PWA and the mock OTA all handle errors the same way.
 *
 * Express 5 detail: if an `async` route handler throws, Express 5 automatically passes
 * the error to the error handler below. (Express 4 didn't. You had to wrap every route
 * in try/catch or the request would hang.)
 */

/**
 * An error we throw on purpose, carrying an HTTP status and a machine-readable code.
 * Example: throw new HttpError(404, 'BOOKING_NOT_FOUND', 'No booking with that reference');
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details] extra fields for the client, e.g. validation issues
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Runs when no route matched the request.
 * @type {import('express').RequestHandler}
 */
export function notFound(req, _res, next) {
  next(new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

/**
 * The single error handler. Express knows it's an error handler because it takes
 * FOUR arguments; that's why `_next` is there even though we don't use it.
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }

  // Prisma P2002 = a UNIQUE constraint said no. Usually our code checks first and returns a
  // friendly 409, but two requests racing each other can both pass that check; then the
  // database is the referee. Answer 409 Conflict instead of a scary 500.
  if (err?.code === 'P2002') {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'That already exists. Refresh and try again.' },
    });
    return;
  }

  // Express itself raises errors with a `status`, e.g. 400 for malformed JSON bodies.
  const status = typeof err?.status === 'number' && err.status < 500 ? err.status : 500;
  if (status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: err.message } });
    return;
  }

  // Anything else is a bug. Log the details for us, but never leak internals
  // (stack traces, SQL, file paths) to the client.
  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
