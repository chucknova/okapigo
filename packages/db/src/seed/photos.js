// @ts-check
/**
 * photos.js — gives the demo business its photos and logo (stage 19b-1).
 *
 *   seedDemoPhotos(prisma, operator, { media })
 *     each tour   its photos from ./photos (cover first), with their descriptions and credits
 *     the website its logo, and its hero photo (Tinubu Square)
 *
 * The pictures go through @okapigo/media exactly as an owner's uploads do: checked, resized,
 * stripped of hidden details, stored. So the demo shows what the real path makes.
 * Pictures are named by their content, so the nightly reset stores nothing new: it finds the
 * same files and points the new copy of the business at them.
 *
 * Run by the dev seed (`pnpm db:seed`) and the demo reset (`pnpm demo:reset`, the nightly
 * job), never by the tests' quiet businesses (they'd spend seconds resizing photos each time).
 */
import { readFile } from 'node:fs/promises';
import { storeImage } from '@okapigo/media';
import { TOUR_PHOTOS, HERO_PHOTO, LOGO_FILE, creditOf } from './photos/credits.js';

const folder = new URL('./photos/', import.meta.url);
/** @param {string} file */
const bytesOf = (file) => readFile(new URL(file, folder));

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ id: string }} operator
 * @param {{ media: import('@okapigo/media').Storage }} options
 * @returns {Promise<{ photos: number, tours: number }>}
 */
export async function seedDemoPhotos(prisma, operator, { media }) {
  /** One stored picture per file, even when used twice (Tinubu Square: a tour and the hero). */
  const stored = new Map();
  /** @param {string} file @param {'photo' | 'logo'} kind */
  const store = async (file, kind) => {
    if (!stored.has(file)) stored.set(file, await storeImage(media, await bytesOf(file), kind));
    return stored.get(file);
  };

  let tours = 0;
  for (const [slug, photos] of Object.entries(TOUR_PHOTOS)) {
    const saved = [];
    // One at a time: resizing is heavy, and a small server has one or two cores.
    for (const p of photos) {
      const { url, small } = await store(p.file, 'photo');
      saved.push({ url, small, alt: p.alt, credit: creditOf(p) });
    }
    const { count } = await prisma.product.updateMany({
      where: { operatorId: operator.id, slug },
      data: { photos: saved },
    });
    tours += count;
  }

  const logo = await store(LOGO_FILE, 'logo');
  const hero = await store(HERO_PHOTO.file, 'photo');
  const current = await prisma.operator.findUniqueOrThrow({ where: { id: operator.id } });
  await prisma.operator.update({
    where: { id: operator.id },
    data: {
      site: {
        .../** @type {object} */ (current.site ?? {}),
        logo: { url: logo.url, small: logo.small },
        hero: {
          url: hero.url,
          small: hero.small,
          alt: HERO_PHOTO.alt,
          credit: creditOf(HERO_PHOTO),
        },
      },
    },
  });
  // Different photos stored (Tinubu Square, used twice, counts once); the logo isn't one.
  return { photos: stored.size - 1, tours };
}
