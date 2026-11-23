/**
 * Stage 19a-2: the public demo's reset. Wiped and made again as a DEMO business with its
 * history, dated from "now"; and the nightly job's safety: never a business that isn't a demo.
 * (Small histories: the full one is tested in history.test.js, and is slow.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { zonedTimeToUtc } from '@okapigo/shared/time';
import { createPrismaClient, seedDemoOperator } from '../src/index.js';
import { resetDemo } from '../src/seed/reset.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStorage } from '@okapigo/media';

/** The pictures go to a temporary folder, never the repo's .data/media (19b-1). */
const media = localStorage({
  dir: join(tmpdir(), 'okapigo-test-media'),
  publicUrl: 'http://localhost:4000/media',
});

/** @type {import('@prisma/client').PrismaClient} */
let prisma;
const slugs = /** @type {string[]} */ ([]);
const SIZE = { pastBookings: 20, upcomingBookings: 4 };
const slug = () => {
  const s = `test-reset-${randomUUID().slice(0, 6)}`;
  slugs.push(s);
  return s;
};

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
});
afterAll(async () => {
  await prisma.operator.deleteMany({ where: { slug: { in: slugs } } });
  await prisma.$disconnect();
});

describe('resetDemo', () => {
  it('the first time: a demo business with its history', async () => {
    const s = slug();
    const r = await resetDemo(prisma, { slug: s, size: SIZE, media });
    expect(r).toMatchObject({ skipped: false, removed: 0 });
    const op = await prisma.operator.findUniqueOrThrow({ where: { slug: s } });
    expect(op.isDemo).toBe(true);
    expect(await prisma.booking.count({ where: { operatorId: op.id } })).toBeGreaterThan(20);
    // Its photos and logo (19b-1): every tour on sale has its 3 or more.
    expect(r).toMatchObject({ photos: 18 });
    const tours = await prisma.product.findMany({ where: { operatorId: op.id } });
    expect(tours.every((t) => /** @type {unknown[]} */ (t.photos).length >= 3)).toBe(true);
    expect(/** @type {any} */ (op.site).logo.url).toMatch(
      /^http:\/\/localhost:4000\/media\/logos\//,
    );
  }, 120_000);

  it('the next night: the old copy gone (and everything under it), a new one dated from now', async () => {
    const s = slug();
    const monday = zonedTimeToUtc('2026-11-23', '04:00', 'Africa/Lagos');
    const first = await resetDemo(prisma, { slug: s, now: monday, size: SIZE, media });
    if (first.skipped) throw new Error('skipped');
    const tuesday = zonedTimeToUtc('2026-11-24', '04:00', 'Africa/Lagos');
    const second = await resetDemo(prisma, { slug: s, now: tuesday, size: SIZE, media });
    if (second.skipped) throw new Error('skipped');
    expect(second.removed).toBe(1);
    expect(second.operatorId).not.toBe(first.operatorId);
    // Nothing of the old copy is left.
    expect(await prisma.booking.count({ where: { operatorId: first.operatorId } })).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { operatorId: first.operatorId } })).toBe(
      0,
    );
    // The calendar moved with it: the past runs up to Tuesday, the future starts there.
    const latestPast = await prisma.departure.findFirstOrThrow({
      where: { operatorId: second.operatorId, startsAt: { lt: tuesday } },
      orderBy: { startsAt: 'desc' },
    });
    expect(latestPast.startsAt.getTime()).toBeGreaterThan(monday.getTime());
  }, 180_000);

  it('the nightly job never touches a business that isn’t a demo one', async () => {
    const s = slug();
    const real = await seedDemoOperator(prisma, { slug: s });
    const r = await resetDemo(prisma, { slug: s, onlyIfDemo: true, size: SIZE, media });
    expect(r).toEqual({ skipped: true, reason: `"${s}" is not a demo business: left alone.` });
    expect((await prisma.operator.findUniqueOrThrow({ where: { slug: s } })).id).toBe(real.id);
    // By hand (pnpm demo:reset), it may: it becomes the demo.
    const byHand = await resetDemo(prisma, { slug: s, size: SIZE, media });
    expect(byHand).toMatchObject({ skipped: false, removed: 1 });
  }, 180_000);

  it('the nightly job resets a demo business, and makes one where there was none', async () => {
    const s = slug();
    expect(await resetDemo(prisma, { slug: s, onlyIfDemo: true, size: SIZE, media })).toMatchObject(
      {
        skipped: false,
        removed: 0,
      },
    );
    expect(await resetDemo(prisma, { slug: s, onlyIfDemo: true, size: SIZE, media })).toMatchObject(
      {
        skipped: false,
        removed: 1,
      },
    );
  }, 180_000);

  it('your own seed is never a demo business (your messages go out as before)', async () => {
    const op = await seedDemoOperator(prisma, { slug: slug() });
    expect(op.isDemo).toBe(false);
  });
});
