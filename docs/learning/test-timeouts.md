# Why a few tests timed out in full runs (and the fix)

An investigation after stage 12h. For several stages, `pnpm test` sometimes failed with one or
two API tests stopped at the 20-second limit, then passed on the next run. Alone, those tests
take about 1.5 seconds.

## 1. What it was NOT

Each idea was checked, not assumed:

| Suspect                                             | How it was checked                                                                                                               | Result                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Tests waiting on each other's locks in Postgres     | a watcher asked Postgres every second, across 7 full runs, for any query waiting over 2 s and any transaction left open over 5 s | **none**                  |
| Running out of database connections (100 allowed)   | the same watcher counted connections                                                                                             | never near                |
| One package's clean-up deleting another's test data | read `global-setup.js`: it only deletes test businesses over 10 minutes old                                                      | already safe              |
| A slow disk (every commit waits for it in Docker)   | timed seeding 1 and 8 at once, with and without waiting for the disk                                                             | no difference             |
| Something else on the network                       | listed every `fetch` the code makes; checked every test simulator                                                                | all faked now (see 12h-1) |

One real cause had already been found and fixed in stage 12h-1: the tests' payment
simulator sent its webhooks to `http://localhost:4000`, so a test could hang whenever the dev
API there was restarting. But time-outs still happened after that fix.

## 2. What it WAS: cold starts, all at once

The clue was in the failures themselves:

- **Every API time-out was the FIRST test in its file** (6 of 6; checked line by line).
- They came **in pairs**, in different files, in the same run.
- They stopped at **exactly** the limit (20.7–20.9 s): stuck behind something, not merely slow.

Then a measurement in a fresh process:

```
first seed: 400–1000 ms     second seed: ~125 ms     a NEW client, same process: ~165 ms
```

**Prisma 7 compiles each new shape of query the first time a process uses it, and keeps it
for that process.** Seeding a demo business uses many shapes. So the first test of a file pays
a one-off compile inside its own 20 seconds.

On its own that's under a second. But `pnpm test` starts every test process **at the same
moment**, so all those first tests compile together and fight for the CPU (with Postgres,
in Docker, on the same machine). Now and then one of them passed 20 s. That's why they came in
pairs: they were the ones starting together.

## 3. The fix

`packages/db/test-support/warm-up.js`, a Vitest **setup file** for the API, database and
worker tests: before a file's tests start, it seeds one throwaway business and deletes it,
inside a hook with its own 60-second limit. The test limit then measures the test, not the
warm-up. In a process that's already warm it costs about 0.15 s.

Not chosen:

- **a longer test limit**: it would hide real slowness too
- **fewer test processes**: already tuned in stage 11b; it only made it rarer

## 4. The proof

Full `pnpm test` runs with the verbose reporter, comparing the four slowest tests:

| Runs (3 each, loads 9–23) | Slowest four tests                                | Failures      |
| ------------------------- | ------------------------------------------------- | ------------- |
| without the warm-up       | 8.5–9.8 s, every run                              | 0 (this time) |
| with the warm-up          | mostly 3.3–5.6 s (once 7.2, once 10.4 at load 23) | 0             |

The slowest tests are now ordinary ones in the middle of their files, not first tests. The
gap to the 20-second limit has roughly doubled.

## 5. Concepts to study

- **Cold start vs warm**: one-off costs (compiling, loading, caches) vs steady state
- **Test isolation in Vitest**: setup files, `beforeAll`, hook limits vs test limits
- **Reading timing patterns**: "always the first test", "two at once", "exactly the limit"
- `pg_stat_activity`, `pg_blocking_pids()` and `pg_locks`: watching Postgres from outside
- **Measure, don't guess**: a before/after comparison under the same conditions

## 6. If it ever comes back

1. Run the suite with `pnpm turbo run test -- --reporter=verbose` and look at the slowest tests.
2. If a first test is the slow one: something new is cold (a new library, a new kind of query
   that the seed doesn't use). Warm that too.
3. If a test in the middle of a file is slow: look at that test.
