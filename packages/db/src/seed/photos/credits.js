// @ts-check
/**
 * credits.js — the demo's photos: where each came from, who took it, its licence, and where
 * it's used (stage 19b-1). The single source of truth: the seed reads it, and CREDITS.md in
 * this folder says the same for people.
 *
 * Every photo is from Wikimedia Commons, chosen and OK'd one by one (2026-11-23), and stored
 * here as Commons' own 1280 px copy (Tinubu Square and the amala are smaller originals). The
 * app makes its resized copies from these; nothing else is changed.
 *
 * The licences ask for credit: the author and the licence, shown with the photo
 * ("Photo: Sho photography, CC BY-SA 4.0"). CC BY-SA also asks that changed versions keep the
 * same licence; resized copies keep it.
 *
 * Per tour, the FIRST photo is the cover. Every tour has at least 3 (the rule to go on sale).
 * The logo is not a photo: it was drawn for the demo (irin-logo.svg, rendered to irin-logo.png).
 */

const BY_SA = 'CC BY-SA 4.0';
const BY = 'CC BY 4.0';
const LICENCE_URL = {
  [BY_SA]: 'https://creativecommons.org/licenses/by-sa/4.0/',
  [BY]: 'https://creativecommons.org/licenses/by/4.0/',
  'Public domain': null,
};

/**
 * @typedef {object} DemoPhoto
 * @property {string} file       in this folder
 * @property {string} alt        what a screen reader says
 * @property {string} author
 * @property {keyof typeof LICENCE_URL} licence
 * @property {string} source     its page on Wikimedia Commons
 */

/** @param {string} title @returns {string} */
const commons = (title) => `https://commons.wikimedia.org/wiki/File:${title}`;

/** Each tour's photos, cover first. @type {Record<string, DemoPhoto[]>} */
export const TOUR_PHOTOS = {
  'lagos-island-heritage-walk': [
    {
      file: 'cathedral-church-of-christ.jpg',
      alt: 'The Cathedral Church of Christ’s grey stone tower and clock, on the Marina',
      author: 'Sho photography',
      licence: BY_SA,
      source: commons('Cathedral_Church_of_Christ,_CMS,_Lagos.jpg'),
    },
    {
      file: 'tinubu-square.jpg',
      alt: 'Tinubu Square’s fountain from above, where the walk begins',
      author: 'Joeyjayjuniors',
      licence: BY_SA,
      source: commons('Tinubu_square.jpg'),
    },
    {
      file: 'lagos-marina-skyline.jpg',
      alt: 'The Marina’s towers seen across the lagoon',
      author: 'kopee15',
      licence: 'Public domain',
      source: commons('Lagos_skyline_with_marina.jpg'),
    },
  ],
  'lagos-street-food-crawl': [
    {
      file: 'suya.jpg',
      alt: 'Suya skewers, spiced and ready for the grill',
      author: 'Kambai Akau',
      licence: BY_SA,
      source: commons('Suya_preparation_for_grilling_1.jpg'),
    },
    {
      file: 'puff-puff.jpg',
      alt: 'Hands rolling puff-puff dough into balls',
      author: 'Dappasolomon001',
      licence: BY_SA,
      source: commons('Puff_Puff_Making_series_4.jpg'),
    },
    {
      file: 'amala-ewedu.jpg',
      alt: 'Amala with ewedu, fish and pomo stew, and a cup of zobo',
      author: 'Halima Waziri',
      licence: BY_SA,
      source: commons('Amala_and_Ewedu_with_fish_and_pomo_stew_and_zobo.jpg'),
    },
    {
      file: 'jollof-rice.jpg',
      alt: 'Jollof rice and fried chicken on a patterned plate',
      author: 'Ei’eke',
      licence: BY_SA,
      source: commons('A_Nigeria_Jollof_Rice_with_chicken.jpg'),
    },
  ],
  'lekki-nature-and-craft': [
    {
      file: 'lekki-canopy-walkway.jpg',
      alt: 'The canopy walkway at Lekki Conservation Centre, high above the trees',
      author: 'Dayoakinbode',
      licence: BY_SA,
      source: commons('Walking_above_Trees.jpg'),
    },
    {
      file: 'lekki-mona-monkey.jpg',
      alt: 'A mona monkey on a tree trunk at the Conservation Centre',
      author: 'James Moore200',
      licence: BY_SA,
      source: commons('Monkey_at_Lekki_Conservation_Centre_01.jpg'),
    },
    {
      file: 'lekki-koi-pond.jpg',
      alt: 'The green koi pond and a thatched hut among the trees',
      author: 'Ashinze',
      licence: BY_SA,
      source: commons('Koi_Pond_at_LEKKI_CONSERVATION_CENTRE_LAGOS,_NIGERIA_(LCC)_15.jpg'),
    },
    {
      file: 'lekki-canopy-walkway-2.jpg',
      alt: 'The canopy walkway’s nets and towers in the forest',
      author: 'Ashinze',
      licence: BY_SA,
      source: commons('LEKKI_CONSERVATION_CENTRE_(LCC)_10.jpg'),
    },
  ],
  'tarkwa-bay-beach-and-lagoon': [
    {
      file: 'tarkwa-bay-beach.jpg',
      alt: 'Tarkwa Bay’s sandy beach, with towers on the far shore',
      author: 'Liesel81',
      licence: BY_SA,
      source: commons('Tarkwa_Bay_Beach_Front.jpg'),
    },
    {
      file: 'tarkwa-bay-shore.jpg',
      alt: 'Waves on the rocks at Tarkwa Bay, Eko Atlantic’s towers across the water',
      author: 'OfficialKOL',
      licence: BY_SA,
      source: commons('Tarkwa_bay_beach,_Lagos,_Nigeria.jpg'),
    },
    {
      file: 'lagos-lagoon-speedboat.jpg',
      alt: 'Crossing the lagoon by speedboat, under the Ikoyi Link Bridge',
      author: 'FrankvEck',
      licence: BY_SA,
      source: commons('Lagos-Nigeria-Ikoyi-Link-bridge-boats-in-lagoon-IMG_7632.jpg'),
    },
  ],
  'badagry-heritage-day-trip': [
    {
      file: 'badagry-point-of-no-return.jpg',
      alt: 'The Point of No Return monument at Badagry, among palm trees',
      author: 'Ei’eke',
      licence: BY,
      source: commons('Point_of_no_return,_Badagry.jpg'),
    },
    {
      file: 'badagry-sunset.jpg',
      alt: 'The Point of No Return monument against an orange evening sky',
      author: 'Mrnyben1313',
      licence: BY_SA,
      source: commons('Sunset_at_the_Point_of_no_Return_at_Gberefun_Island,_Badagry.jpg'),
    },
    {
      file: 'badagry-first-storey-building.jpg',
      alt: 'The First Storey Building in Nigeria, a white mission house from 1845',
      author: 'Omoeko Media',
      licence: BY_SA,
      source: commons('First_storey_building_in_Nigeria_in_Badagry_Lagos_State-_Nigeria.jpg'),
    },
    {
      file: 'badagry-first-storey-building-2.jpg',
      alt: 'The First Storey Building in Nigeria behind a fallen leaf',
      author: 'Solasly',
      licence: BY_SA,
      source: commons('25644461_First_Storey_Building_in_Nigeria,_Badagry.jpg'),
    },
  ],
};

/** The website's hero photo. @type {DemoPhoto} */
export const HERO_PHOTO = {
  ...TOUR_PHOTOS['lagos-island-heritage-walk'][1],
  alt: 'Tinubu Square’s fountain from above, with Lagos Island’s towers behind',
};

/** Ìrìn's logo: drawn for the demo, no credit needed. */
export const LOGO_FILE = 'irin-logo.png';

/** "Sho photography, CC BY-SA 4.0" — the credit shown with a photo. @param {DemoPhoto} p */
export const creditOf = (p) => `${p.author}, ${p.licence}`;

/** @param {DemoPhoto} p */
export const licenceUrlOf = (p) => LICENCE_URL[p.licence];
