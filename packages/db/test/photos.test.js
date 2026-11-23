// @ts-check
/**
 * Stage 19b-1: the demo's photos and logo.
 *   the files, the credits list and CREDITS.md agree; every demo tour has 3 to 8 photos
 *   seedDemoPhotos: photos with descriptions and credits, cover first; the logo and hero; the
 *   hidden details gone; run again, nothing new stored
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { localStorage } from '@okapigo/media';
import { PhotoSchema, MAX_TOUR_PHOTOS } from '@okapigo/shared/schemas/products';
import { SiteSchema } from '@okapigo/shared/schemas/website';
import { notReadyMessage, MIN_PHOTOS_TO_SELL } from '@okapigo/shared/ready-to-sell';
import { createPrismaClient, seedDemoOperator } from '../src/index.js';
import { seedDemoPhotos } from '../src/seed/photos.js';
import { TOUR_PHOTOS, HERO_PHOTO, LOGO_FILE, creditOf } from '../src/seed/photos/credits.js';
import { TOURS } from '../src/seed/tours.js';

const FOLDER = new URL('../src/seed/photos/', import.meta.url);
const listed = Object.values(TOUR_PHOTOS).flat();

describe('the files and their credits', () => {
  it('every picture in the folder is credited, and every credited one is there', async () => {
    const files = (await readdir(FOLDER)).filter((f) => /\.(jpg|png)$/.test(f));
    const credited = new Set([...listed.map((p) => p.file), LOGO_FILE]);
    expect(files.sort()).toEqual([...credited].sort());
    expect(listed).toHaveLength(18);
  });

  it('CREDITS.md names every photo with its author and source', async () => {
    const md = await readFile(new URL('CREDITS.md', FOLDER), 'utf8');
    for (const p of listed) {
      expect(md).toContain(`\`${p.file}\``);
      expect(md).toContain(p.author);
      expect(md).toContain(p.source);
    }
  });

  it('every demo tour has its photos: at least 3 (to be on sale), at most 8', () => {
    const slugs = TOURS.map((/** @type {{ slug: string }} */ t) => t.slug).sort();
    expect(Object.keys(TOUR_PHOTOS).sort()).toEqual(slugs);
    for (const photos of Object.values(TOUR_PHOTOS)) {
      expect(photos.length).toBeGreaterThanOrEqual(MIN_PHOTOS_TO_SELL);
      expect(photos.length).toBeLessThanOrEqual(MAX_TOUR_PHOTOS);
      for (const p of photos) {
        expect(p.alt.length).toBeGreaterThan(10);
        expect(p.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      }
    }
    expect(creditOf(HERO_PHOTO)).toBe('Joeyjayjuniors, CC BY-SA 4.0');
  });
});

describe('seedDemoPhotos', () => {
  /** @type {import('@prisma/client').PrismaClient} */
  let prisma;
  /** @type {string} */
  let dir;
  const slug = `test-photos-${randomUUID().slice(0, 6)}`;
  beforeAll(async () => {
    prisma = createPrismaClient(process.env.DATABASE_URL);
    dir = await mkdtemp(join(tmpdir(), 'okg-demo-photos-'));
  });
  afterAll(async () => {
    await prisma.operator.deleteMany({ where: { slug } });
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  it('gives each tour its photos, and the website its logo and hero; once is enough', async () => {
    const media = localStorage({ dir, publicUrl: 'http://localhost:4000/media' });
    const operator = await seedDemoOperator(prisma, { slug });
    const taglineBefore = /** @type {any} */ (operator.site).tagline;

    const r = await seedDemoPhotos(prisma, operator, { media });
    expect(r).toEqual({ photos: 18, tours: 5 });

    const tours = await prisma.product.findMany({ where: { operatorId: operator.id } });
    for (const t of tours) {
      const photos = /** @type {any[]} */ (t.photos);
      const expected = TOUR_PHOTOS[t.slug];
      expect(photos.map((p) => p.alt)).toEqual(expected.map((p) => p.alt)); // cover first
      expect(photos.map((p) => p.credit)).toEqual(expected.map(creditOf));
      for (const p of photos) {
        expect(PhotoSchema.safeParse(p).success).toBe(true);
        expect(media.keyOf(p.url)).toMatch(/^photos\//);
        expect(media.keyOf(p.small)).toMatch(/-640\.jpg$/);
      }
      // Ready to be on sale, as the demo's tours are.
      expect(notReadyMessage({ activePrices: 1, photoCount: photos.length })).toBeNull();
    }

    const site = /** @type {any} */ (
      (await prisma.operator.findUniqueOrThrow({ where: { id: operator.id } })).site
    );
    expect(SiteSchema.safeParse(site).success).toBe(true);
    expect(site.tagline).toBe(taglineBefore); // the rest of the site kept
    expect(media.keyOf(site.logo.url)).toMatch(/^logos\/[a-f0-9]{16}\.png$/);
    expect(media.keyOf(site.logo.small)).toMatch(/-128\.png$/);
    expect(site.hero).toMatchObject({
      alt: HERO_PHOTO.alt,
      credit: 'Joeyjayjuniors, CC BY-SA 4.0',
    });
    // The hero is the walk's Tinubu Square photo: stored once.
    const walk = tours.find((t) => t.slug === 'lagos-island-heritage-walk');
    const walkPhotos = /** @type {any[]} */ (walk?.photos ?? []);
    expect(site.hero.url).toBe(walkPhotos[1].url);

    // 18 photos × 2 sizes, and the logo × 2.
    expect(await readdir(join(dir, 'photos'))).toHaveLength(36);
    expect(await readdir(join(dir, 'logos'))).toHaveLength(2);

    // The cathedral's file carries its photographer's copyright note in hidden details:
    // the stored copies carry none.
    const original = await sharp(
      await readFile(new URL('cathedral-church-of-christ.jpg', FOLDER)),
    ).metadata();
    expect(original.exif).toBeDefined();
    const cover = walkPhotos[0];
    const stored = await media.get(/** @type {string} */ (media.keyOf(cover.url)));
    expect((await sharp(/** @type {Buffer} */ (stored)).metadata()).exif).toBeUndefined();

    // Again (the nightly reset): the same files, nothing new.
    await seedDemoPhotos(prisma, operator, { media });
    expect(await readdir(join(dir, 'photos'))).toHaveLength(36);
  }, 180_000); // resizing 19 pictures: seconds alone, much longer on a busy machine
});
