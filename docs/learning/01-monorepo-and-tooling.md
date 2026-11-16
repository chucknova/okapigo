# Session 1: Monorepo, local infrastructure, API skeleton and CI

**PRD coverage:** Build step 1 (part 1 of 3). No feature requirements yet. This session builds
the ground everything else stands on.

**Done when:** `pnpm dev` starts the API, `/health` reports PostgreSQL and Redis as `ok`, tests
pass locally, and CI runs on every push. ✅ (CI goes green once you push to GitHub.)

---

## 1. What we built

```
OkapiGo/
├── package.json            root: workspace scripts + repo-wide dev tools
├── pnpm-workspace.yaml     "apps/* and packages/* are packages"
├── turbo.json              how to run dev/build/test across packages
├── docker-compose.yml      PostgreSQL 17 + Redis 7 for local development
├── .env.example            settings template (copied to .env, which git ignores)
├── eslint.config.js        lint rules for every package
├── .prettierrc.json        formatting rules
├── .github/workflows/ci.yml
└── apps/api/
    ├── src/
    │   ├── config.js          validates environment variables at startup (Zod)
    │   ├── app.js             builds the Express app (no listening)
    │   ├── server.js          opens connections, listens, shuts down gracefully
    │   ├── lib/logger.js      structured logging (pino)
    │   ├── lib/connections.js PostgreSQL pool + Redis client
    │   ├── routes/health.js   GET /health
    │   └── middleware/errors.js  404 + one error handler, one error shape
    └── test/                  12 tests: unit (fakes) + integration (real services)
```

## 2. How it works

### A request's journey through the API

```
curl /health
   │
   ▼
helmet ──► pino-http ──► express.json ──► healthRouter ──► (no match?) notFound ──► errorHandler
security   logs + gives    parses JSON      runs the          builds a 404           turns ANY error
headers    a request ID    bodies           checks                                   into { error: {...} }
```

Express runs **middleware** in the order you `app.use()` them. Each one either answers the
request or calls `next()` to pass it along. That's why `notFound` and `errorHandler` are added
last: they only run when nothing earlier answered.

### How /health decides "ok" vs "degraded"

It runs `SELECT 1` on PostgreSQL and `PING` on Redis **at the same time** (`Promise.all`).
Each check goes through `probe()`, which races it against a 2-second timer
(`Promise.race`). Whichever finishes first wins, so a hung database can't freeze the endpoint.
All ok → **200**. Anything failing → **503**, with the failing service named.

### app.js vs server.js (the most important idea this session)

`createApp({ logger, db, redis })` **receives** its connections instead of creating them.
This is **dependency injection**. It pays off immediately in the tests:

```js
// Simulate "PostgreSQL is down" without touching the real database:
const app = createApp({ logger: silentLogger, db: failing, redis: healthyRedis });
const res = await request(app).get('/health');
expect(res.status).toBe(503);
```

We'll use this pattern for everything with outside effects: Paystack, WhatsApp, email and the
AI model. That's how the PRD's rule "a simulator and a real sandbox are interchangeable" is
implemented in practice.

## 3. Why we chose what we chose

| Choice                             | Why                                                                                                                            | Trade-off                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Monorepo (pnpm workspaces)**     | API, PWA, guest web, mock OTA and shared code live together. One change to pricing rules updates every app in one commit.      | One bigger repo; tooling (Turborepo) needed to keep it fast.                 |
| **Turborepo**                      | Runs `dev`/`test`/`build` in every package with one command, in dependency order, with caching.                                | Another tool to learn, but it barely matters until we have several packages. |
| **Docker only for infrastructure** | Postgres/Redis are the same everywhere; our Node code runs natively so reloads are instant and debugging is easy.              | You need Docker Desktop running.                                             |
| **Express 5**                      | Your preferred stack. v5 forwards errors from `async` handlers automatically, removing a classic Express 4 bug.                | Fewer built-in features than NestJS etc. We add structure ourselves.         |
| **Zod for config**                 | Bad settings crash at startup with a clear message, not on the first request. Same tool we'll use to validate every API input. | —                                                                            |
| **pino (structured logs)**         | JSON logs can be searched by field (request ID, booking ref). It's fast too.                                                   | Raw JSON is ugly, so pino-pretty makes it readable in development.           |
| **`// @ts-check` + JSDoc**         | Your editor flags type mistakes in plain JavaScript (hover over `createApp` to see its parameter types).                       | Less strict than TypeScript; the PRD plans to move to TS gradually from v1.  |
| **Real services in tests**         | Fakes prove the logic; one integration test proves the real wiring. It caught a real bug this session (see Gotchas).           | Tests need `pnpm services:up` locally.                                       |

**Deviation from the plan:** I said I'd create `apps/workers`, `packages/shared` and
`packages/db` folders now. I didn't. Empty placeholder packages add noise and make you wonder
what's in them. Each arrives in the session that gives it real code (db → session 2, shared →
session 5, workers → session 6).

## 4. Concepts to study

- **Middleware in Express**: the `(req, res, next)` chain, and why error handlers take 4 arguments.
- **Dependency injection**: passing dependencies in rather than creating them inside.
- **Promise.all vs Promise.race**: run things in parallel vs take whichever finishes first.
- **HTTP status codes**: 200, 400, 404, 500 and 503 (and why 503, not 500, for "a dependency is down").
- **Environment variables and 12-factor config**: why settings live in the environment, not the code.
- **Graceful shutdown**: SIGINT/SIGTERM, `server.close()`.
- **Docker basics**: images vs containers, ports (`5432:5432`), named volumes, healthchecks.
- **CI service containers** in GitHub Actions.

## 5. Try it yourself

```bash
pnpm services:up && pnpm dev
curl -i localhost:4000/health          # note the X-Request-Id header
curl localhost:4000/anything           # JSON 404
docker compose stop redis              # break Redis...
curl -i localhost:4000/health          # ...503, redis: "error"
docker compose start redis             # fix it; ioredis reconnects on its own
```

Experiments worth doing:

1. Delete `DATABASE_URL` from `.env` and run `pnpm dev`. Read the error you get.
2. In `apps/api/test/health.test.js`, change an expected `503` to `200` and run `pnpm test`.
   Watch it fail, then undo.
3. Send your own request ID: `curl -i -H 'X-Request-Id: hello' localhost:4000/health`.
4. Connect to the database directly:
   `docker compose exec postgres psql -U okapigo` and then `\l` to list databases (`\q` to quit).

## 6. Gotchas

- **The bug the integration test caught.** I first configured Redis with
  `enableOfflineQueue: false` so a dead Redis would fail fast. But that also makes commands fail
  in the first few milliseconds _after startup_, before the connection is open. So `/health`
  would wrongly say "Redis down" right after every deploy. The unit tests (with fakes) couldn't
  see this; only the real-Redis test did. Fix: keep the queue and rely on `probe()`'s timeout.
  **Lesson: fakes test your logic, not your assumptions about real libraries.**
- **Docker Desktop must be running** before `pnpm services:up` or `pnpm test`.
- **`.env` is never committed.** Only `.env.example`. Real secrets would go in your host's
  dashboard (Render/Railway) later.
- **Ports 5432/6379 must be free.** If you ever install Postgres via Homebrew, it will clash.

## 7. What's next: session 2

Prisma and the first database tables: **Operator** (the tenant) and **User** (staff with
roles). We'll create the first migration and a seed script that creates Ìrìn Lagos Tours and its
staff (owner, operations manager, four guides). A new `packages/db` package will hold the schema.
