# Session 2: The database. Operators, roles and staff

**PRD coverage:** Build step 1 (part 2 of 3). Lays the data for **ACC-05** (roles and
permissions) and **ACC-01** (sign-up by phone or email). Enforcement comes in session 3.

**Done when:** `pnpm db:reset` rebuilds the database from migrations and seeds Ìrìn Lagos Tours;
tests prove the database enforces its own rules. ✅

---

## 1. What we built

```
packages/
├── db/
│   ├── prisma/
│   │   ├── schema.prisma               the tables, as Prisma models
│   │   └── migrations/2026…_init_…/    the SQL that builds them (committed!)
│   ├── prisma.config.js                Prisma 7 CLI settings (DB URL, seed command)
│   ├── src/client.js                   createPrismaClient(url)
│   ├── src/seed/demo-operator.js       seedDemoOperator(prisma, { slug })
│   ├── src/seed/run.js                 what `pnpm db:seed` runs
│   └── test/schema.test.js             11 tests against the real database
└── shared/
    └── src/permissions.js              modules, access levels, the 3 preset roles
```

### The tables

```
operators                    roles                              users
─────────                    ─────                              ─────
id (uuid) ◄──────────┬────── operator_id                 ┌───── operator_id
name                 │       id ◄─────────────────────┐  │      role_id
slug (unique)        │       key  (owner/manager/…)   └──┼───── (role_id, operator_id)
currency  = NGN      │       permissions (JSONB)         │      name, email?, phone?
time_zone = Lagos    │       is_preset                   │      is_active
website_style        └───────────────────────────────────┘
```

Seeded: **Ìrìn Lagos Tours**, 3 preset roles, 6 staff (Adaeze, owner; Tunde, manager; Kemi,
Chinedu, Halima and Femi, guides). Run `pnpm db:studio` to browse them.

## 2. How it works

### From schema to database: the migration workflow

```
edit schema.prisma ──► pnpm db:migrate --name add_x ──► prisma/migrations/<time>_add_x/migration.sql
                                                         (review it, add hand-written SQL if needed)
                                                              │
                         your DB ◄── applied ◄────────────────┤
                         CI's DB ◄── migrate deploy ◄─────────┤  same SQL everywhere
                       demo's DB ◄── migrate deploy ◄─────────┘
```

**Migrations are committed history.** Never edit one that has already been applied anywhere;
add a new one instead. (We edited ours freely only because it hadn't been applied yet.)

### Multi-tenancy: every row belongs to an operator

The **operator** is the _tenant_, one tour company. Every business row carries `operator_id`.
There's only one operator today, but the PRD's visitor sandboxes create a copy per visitor,
so one operator's data must never leak into another's.

### Rules in the database, not just in code

The most important idea this session: **the database enforces rules itself**, so a bug in the API
can't break them.

| Rule                                      | How it's enforced                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| A user can't hold another operator's role | Composite foreign key: `users(role_id, operator_id)` → `roles(id, operator_id)` |
| Role keys unique within an operator       | `UNIQUE (operator_id, key)`                                                     |
| A user needs an email or a phone          | `CHECK (email IS NOT NULL OR phone IS NOT NULL)`                                |
| Emails stored lowercase                   | `CHECK (email = lower(email))`                                                  |
| Phones in `+234…` format                  | `CHECK (phone ~ '^\+[1-9][0-9]{7,14}$')` (a regex)                              |
| Slugs are URL-safe                        | `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`                                     |
| A role can't be deleted while in use      | `ON DELETE RESTRICT`                                                            |
| Deleting an operator deletes its data     | `ON DELETE CASCADE` (used by sandbox cleanup)                                   |

Prisma's schema language can't express CHECK constraints, so they're **hand-written SQL appended
to the migration** (see the bottom of `migration.sql`).

The composite foreign key is worth reading twice. A normal FK (`role_id → roles.id`) only
proves the role _exists_. Including `operator_id` on both sides proves it belongs to the _same
operator_. Tenant isolation, guaranteed by the database.

### Permissions

`packages/shared/src/permissions.js` defines 8 **modules** (products, bookings, payments,
operations, channels, marketing, reports, settings) and 3 **access levels** (`none < view < edit`).
A role stores one level per module as JSON:

```json
{ "bookings": "view", "operations": "edit", "payments": "none", ... }   ← a guide
```

`hasAccess('edit', 'view') → true`. Session 3's middleware will call that on every route.
It's in `shared` because the API, the seed and (later) the PWA all need the same definition.

## 3. Why we chose what we chose

| Choice                                       | Why                                                                                                                                     | Trade-off                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Prisma 7.10.1, pinned**                    | Stable release. `prisma@latest` points at an 8.0 release candidate, and a money system shouldn't run on pre-release software.           | Upgrade deliberately later.                                        |
| **`prisma-client-js` generator**             | Outputs plain JavaScript into node_modules. Prisma's newer `prisma-client` generator outputs TypeScript, which would need a build step. | It's the older generator; revisit when we move to TypeScript (v1). |
| **Driver adapter (`@prisma/adapter-pg`)**    | Required in Prisma 7. Uses the standard `pg` driver, which works on every host.                                                         | One more package.                                                  |
| **UUID primary keys**                        | Not guessable in URLs (`/bookings/1`, `/bookings/2`…); the offline PWA can create IDs without asking the server.                        | Longer than integers.                                              |
| **snake_case columns via `@map`**            | Postgres convention; raw SQL (row locks in session 6, ledger checks in session 8) needs no quotes.                                      | `@map` on many fields.                                             |
| **Permissions as JSONB on Role**             | Custom roles are just data, with no table per module. Validated by Zod in the API.                                                      | The DB doesn't validate the JSON shape itself.                     |
| **Seed as a reusable function**              | Nightly reset and visitor sandboxes (session 18) need more copies.                                                                      | Slightly more code than a script.                                  |
| **Tests seed their own throwaway operators** | Tests never wipe your dev data and can run in any order.                                                                                | Each test writes a few rows.                                       |

## 4. Concepts to study

- **Relational basics**: primary key, foreign key, unique constraint, index.
- **Composite keys and composite foreign keys.**
- **CHECK constraints** and **PostgreSQL regex** (`~`).
- **`ON DELETE` actions**: CASCADE vs RESTRICT vs SET NULL.
- **Transactions**: all-or-nothing writes (`prisma.$transaction`).
- **Migrations**: why schema changes are versioned files, not manual edits.
- **Multi-tenancy** patterns: "shared database, tenant ID on every row" (what we use).
- **JSONB** in PostgreSQL.
- **E.164** phone number format.

## 5. Try it yourself

```bash
pnpm db:studio                 # opens a browser UI to view/edit tables
pnpm --filter @okapigo/db test # just the database tests
docker compose exec postgres psql -U okapigo
```

Inside `psql`, try breaking the rules yourself:

```sql
\d users                                   -- see columns, indexes, constraints
SELECT name, email FROM users;
UPDATE users SET email = 'KEMI@X.TEST' WHERE name = 'Kemi Adeyemi';   -- rejected: lowercase rule
UPDATE users SET email = NULL, phone = NULL WHERE name = 'Femi Ogunleye'; -- rejected: needs one
SELECT key, permissions->>'payments' AS payments FROM roles;          -- reading JSONB
\q
```

Then add a field yourself and watch the workflow: add `logoUrl String? @map("logo_url")` to
`Operator`, run `pnpm db:migrate --name add_operator_logo`, read the generated SQL, then
`git checkout packages/db/prisma/schema.prisma`, delete the new migration folder and run
`pnpm db:reset` to undo it.

## 6. Gotchas

- **Correction (found in session 3): `migrate reset` doesn't seed in Prisma 7.** Prisma 6 ran
  the seed automatically after a reset; Prisma 7 doesn't. So your first `pnpm db:reset` left an
  empty database. The `reset` script now runs `prisma migrate reset --force && prisma db seed`.
- **`pnpm db:reset` wipes your local database.** Prisma refuses to let an AI agent run it, a
  safety guard, so you run it yourself. I used `migrate deploy` + `seed` instead, which only add.
- **Stale client after schema changes.** `migrate dev` regenerates the Prisma client;
  `migrate deploy` doesn't. I hit this: the seed failed with `ColumnNotFound` because the
  client still expected the old camelCase column names. Fix: `pnpm --filter @okapigo/db generate`.
  (Bright side: the failed seed wrote **0 rows**. The transaction rolled back cleanly.)
- **pnpm 11 blocks install scripts** unless approved in `pnpm-workspace.yaml` under `allowBuilds`.
  Prisma needs one to download its engine. Only approve packages you trust and that need it.
- **Prisma 7 doesn't read `.env` by itself.** `prisma.config.js` loads it. The URL is optional
  there so `pnpm install` works on a fresh clone with no `.env`.
- **Tests that only check "it threw" can lie.** They'd pass if the insert failed for an unrelated
  reason. Our tests assert the _constraint name_ (`/users_role_id_operator_id_fkey/`).

## 7. What's next: session 3

**Sign-in and permissions (ACC-01, ACC-05).** Staff request a one-time code by email or phone
(logged to the console for now; real email/WhatsApp come with messaging in session 13), verify
it, and get a session. Then a `requirePermission('bookings', 'edit')` middleware guards routes,
with Supertest tests proving a guide can't reach the payments API.
