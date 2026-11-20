# The tests' own database and queues

A small stage between sessions 15 and 16, from the parking lot. It removes the cause of most
of the flaky runs since 13c.

## 1. The problem

Every test used the same Postgres database and Redis as the app you run with `pnpm dev`.
Your dev API looks at **every** business every 5 seconds to send messages, and your dev
worker takes jobs from the same queues. So, while you had `pnpm dev` running:

- it sent a test's message before the test could (14c, 15a: "payment didn't go through")
- it answered a browser test's WhatsApp ticket with **its** address, :4000, which the test
  page on :4100 refused to show (journey 2, 15c-4 and 15d)
- its worker shared Redis with the workers' queue test
- and every test business was made in your dev data, cleaned up only on the next run

## 2. The fix

`packages/db/src/testing.js` (imported as `@okapigo/db/testing`):

| Who                                                | Database       | Redis      |
| -------------------------------------------------- | -------------- | ---------- |
| you, `pnpm dev`                                    | `okapigo`      | database 0 |
| unit and integration tests (api, db, workers)      | `okapigo_test` | database 1 |
| browser tests (apps/web/e2e), their API and worker | `okapigo_e2e`  | database 2 |

- `isolate('test' | 'e2e')` is the first thing each test config does: it reads `.env`, then
  points `DATABASE_URL` and `REDIS_URL` at the tests' own. Everything the tests start
  inherits them (the API on :4100, the worker).
- `prepareDatabase()` runs `prisma migrate deploy` on it: creates it if it's missing, applies
  any new migrations, never drops anything. Unit tests do it in their shared global set-up;
  the browser tests in a step of their own (`e2e/prepare-database.js`), because Playwright
  starts the API before its own set-up runs.
- **A guard**: test helpers refuse to run on a database whose name doesn't end in `_test` or
  `_e2e`. Tests delete what they make; they must never do it in your data.
- **Redis databases**: one Redis server holds 16 numbered databases (0–15), each with its own
  keys. `redis://localhost:6379/1` is database 1.

CI is unchanged: its workflow's Postgres user can create databases, so the tests make
`okapigo_test` and `okapigo_e2e` there too.

## 3. Checked, with your `pnpm dev` running

- Both full runs all green (1,249 tests); no test business made in your dev database (all
  in `okapigo_test`, and cleaned up).
- All 9 browser journeys passed, **journey 2 included** (it had failed since 15c-2).

## 4. Left in your dev database

44 businesses left by earlier test runs (43 `test-…`, 1 `test-e2e-…`), besides Ìrìn. Before
this change, each test run removed the older ones; now tests don't run there, so they stay
until removed (or `pnpm db:reset`).

## 5. Concepts to study

- **Test isolation**: why tests and the running app shouldn't share state
- **Environment variables** passed down to child processes; `.env` loading that doesn't
  override what's already set
- **Database migrations** applied to several databases from one set of files
