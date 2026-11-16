# OkapiGo

Booking, payments and operations for Nigerian tour operators. This is the MVP, a portfolio
project that runs one fictional business, **Ìrìn Lagos Tours**, from a guest finding a tour to a
guide checking that guest in with no signal.

> Status: **session 9 of 21**. Staff sign-in with roles, the tour catalogue, schedules with live
> availability, the pricing pipeline, checkout holds with zero oversells, bookings with a
> lifecycle and timeline, and versioned cancellation policies with refunds worked out.
> Learning notes for each session live in [`docs/learning/`](docs/learning/).

## Requirements

- Node.js 24 (`nvm use` reads `.nvmrc`)
- pnpm 11 (`corepack enable` or `brew install pnpm`)
- Docker Desktop (runs PostgreSQL and Redis)

## Run it locally

```bash
cp .env.example .env      # local settings; works as-is
pnpm install              # install every package in the monorepo
pnpm services:up          # start PostgreSQL + Redis in Docker and wait until healthy
pnpm db:reset             # build the database from migrations and seed Ìrìn Lagos Tours
pnpm dev                  # start the API (and later, every app) with auto-reload
```

Then open <http://localhost:4000/health>:

```json
{ "status": "ok", "checks": { "db": "ok", "redis": "ok" } }
```

## Sign in locally

Codes are printed in the `pnpm dev` terminal (real email/WhatsApp delivery arrives in session 13).

```bash
curl -X POST localhost:4000/auth/otp/request -H 'content-type: application/json' \
  -d '{"contact":"adaeze@irin-lagos-tours.example"}'
# copy the 6-digit code from the API log, then:
curl -X POST localhost:4000/auth/otp/verify -H 'content-type: application/json' \
  -d '{"contact":"adaeze@irin-lagos-tours.example","code":"123456"}'
# use the returned token:
curl localhost:4000/api/me -H 'Authorization: Bearer <token>'
```

Seeded staff: `adaeze@` (owner), `tunde@` (manager), `kemi@`, `chinedu@`, `halima@`, `femi@`
(guides), all `@irin-lagos-tours.example`, or phones `0803 000 0001` to `0803 000 0006`.

## Everyday commands

| Command               | What it does                                            |
| --------------------- | ------------------------------------------------------- |
| `pnpm dev`            | Run all apps in watch mode                              |
| `pnpm test`           | Run all tests (needs `pnpm services:up` first)          |
| `pnpm lint`           | Check code for likely bugs (ESLint)                     |
| `pnpm format`         | Auto-format everything (Prettier)                       |
| `pnpm db:migrate`     | After editing schema.prisma: create + apply a migration |
| `pnpm db:reset`       | **Wipe the local database**, re-run migrations, seed    |
| `pnpm db:seed`        | Seed an empty database                                  |
| `pnpm db:studio`      | Browse the database in your browser (Prisma Studio)     |
| `pnpm services:down`  | Stop PostgreSQL and Redis (data is kept)                |
| `pnpm services:reset` | Stop them **and wipe all local data**, then restart     |

## Repository layout

| Path                  | What it holds                                                 |
| --------------------- | ------------------------------------------------------------- |
| `apps/api`            | Express API. The only thing that writes to PostgreSQL         |
| `apps/workers`        | Background jobs (BullMQ): hold expiry, sweeper, schedule roll |
| `packages/jobs`       | Queue names and the job client the API uses to enqueue        |
| `packages/db`         | Prisma schema, migrations, seed script, database client       |
| `packages/shared`     | Code shared by every app: permissions, money, schemas         |
| `docs/learning/`      | One learning note per build session                           |
| `docs/parking-lot.md` | Ideas that are out of MVP scope                               |
| `docker-compose.yml`  | Local PostgreSQL 17 + Redis 7                                 |
| `.github/workflows/`  | CI: lint, format check, tests, dependency audit on every push |

More packages (the guest web, the operator PWA,
the mock OTA and the WhatsApp simulator) arrive in the sessions that need them.

## Stack

Node.js + Express (JavaScript, ES modules) · PostgreSQL · Redis + BullMQ · React + Vite ·
pnpm workspaces + Turborepo · Vitest + Supertest + Playwright · Zod · Paystack test mode.
