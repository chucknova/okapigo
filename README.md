# OkapiGo

Booking, payments and operations for Nigerian tour operators. This is the MVP, a portfolio
project that runs one fictional business, **Ìrìn Lagos Tours**, from a guest finding a tour to a
guide checking that guest in with no signal.

> Status: **session 1 of 18**. Repository, local infrastructure, API skeleton and CI.
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
pnpm dev                  # start the API (and later, every app) with auto-reload
```

Then open <http://localhost:4000/health>:

```json
{ "status": "ok", "checks": { "db": "ok", "redis": "ok" } }
```

## Everyday commands

| Command               | What it does                                        |
| --------------------- | --------------------------------------------------- |
| `pnpm dev`            | Run all apps in watch mode                          |
| `pnpm test`           | Run all tests (needs `pnpm services:up` first)      |
| `pnpm lint`           | Check code for likely bugs (ESLint)                 |
| `pnpm format`         | Auto-format everything (Prettier)                   |
| `pnpm services:down`  | Stop PostgreSQL and Redis (data is kept)            |
| `pnpm services:reset` | Stop them **and wipe all local data**, then restart |

## Repository layout

| Path                  | What it holds                                                 |
| --------------------- | ------------------------------------------------------------- |
| `apps/api`            | Express API. The only thing that writes to PostgreSQL         |
| `docs/learning/`      | One learning note per build session                           |
| `docs/parking-lot.md` | Ideas that are out of MVP scope                               |
| `docker-compose.yml`  | Local PostgreSQL 17 + Redis 7                                 |
| `.github/workflows/`  | CI: lint, format check, tests, dependency audit on every push |

More packages (`packages/db`, `packages/shared`, `apps/workers`, the guest web, the operator PWA,
the mock OTA and the WhatsApp simulator) arrive in the sessions that need them.

## Stack

Node.js + Express (JavaScript, ES modules) · PostgreSQL · Redis + BullMQ · React + Vite ·
pnpm workspaces + Turborepo · Vitest + Supertest + Playwright · Zod · Paystack test mode.
