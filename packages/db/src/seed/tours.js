// @ts-check
/**
 * tours.js — the content of Ìrìn Lagos Tours' five tours (PRD "Demo business and seed data").
 *
 * The places are real Lagos landmarks so the demo feels real, but the PRODUCTS, PRICES,
 * TIMES AND DETAILS ARE ILLUSTRATIVE AND FICTIONAL. Nothing here is a real offer.
 * Map coordinates are approximate.
 *
 * Each tour is chosen to exercise particular requirements:
 *   Heritage Walk     → schedules, capacity, guide assignment, QR check-in
 *   Street Food Crawl → add-ons with limited stock, dietary needs per traveller
 *   Lekki Nature      → van + guide resources, pickup points, child prices
 *   Tarkwa Bay        → boat capacity, weather cancellations under the refund policy
 *   Badagry           → deposits, payment links, balance reminders (30% deposit, session 10)
 *
 * Prices are written in NAIRA here for readability and converted to kobo with nairaToKobo.
 * `schedule` says when each tour runs; the seed turns it into 60 days of departures.
 * Photos are added in the polish session (18), with images we have the rights to use.
 */
import { nairaToKobo } from '@okapigo/shared/money';

/** Ìrìn's standard age bands, shared by every tour. */
const categories = ({ adult, child, infant = 0 }) => [
  {
    key: 'adult',
    name: 'Adult (13+)',
    minAge: 13,
    maxAge: null,
    amountKobo: nairaToKobo(adult),
    sortOrder: 0,
  },
  {
    key: 'child',
    name: 'Child (3–12)',
    minAge: 3,
    maxAge: 12,
    amountKobo: nairaToKobo(child),
    sortOrder: 1,
  },
  {
    key: 'infant',
    name: 'Infant (0–2)',
    minAge: 0,
    maxAge: 2,
    amountKobo: nairaToKobo(infant),
    sortOrder: 2,
  },
];

export const TOURS = [
  {
    slug: 'lagos-island-heritage-walk',
    activityLabel: 'Walking',
    arriveMinutesEarly: 10, // "Arrive by 08:50" on the trip hub (stage 12f)
    // Daily at 09:00, closed on Christmas Day (an exception date).
    schedule: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'], skipChristmas: true },
    title: 'Lagos Island Heritage Walk',
    summary:
      'Three unhurried hours through old Lagos: Tinubu Square, the Brazilian Quarter, the Cathedral and Freedom Park.',
    description:
      'Walk the streets where modern Lagos began. Starting at Tinubu Square, your guide traces the city from royal Lagos through the Brazilian Quarter (Popo Aguda), built by returnees from Brazil and Cuba, to the Cathedral Church of Christ, Freedom Park on the site of the old colonial prison, and the National Museum at Onikan. Expect stories, architecture and plenty of shade stops.',
    status: 'published',
    durationMinutes: 180,
    defaultCapacity: 15,
    meetingPoint: {
      name: 'Tinubu Square',
      address: 'Broad Street, Lagos Island',
      note: 'Look for the guide in the green Ìrìn cap, by the fountain.',
      lat: 6.4541,
      lng: 3.3893,
    },
    stops: [
      { name: 'Tinubu Square', description: 'Where the walk begins: the story of Madam Tinubu.' },
      {
        name: 'Brazilian Quarter (Popo Aguda)',
        description: 'Afro-Brazilian houses built by returnees.',
      },
      {
        name: 'Cathedral Church of Christ',
        description: 'One of the oldest Anglican churches in Lagos.',
      },
      {
        name: 'Freedom Park',
        description: 'A former colonial prison, now a park for arts and memory.',
      },
      {
        name: 'National Museum, Onikan',
        description: 'Treasures from across Nigeria, with time to explore.',
      },
    ],
    inclusions: ['Licensed local guide', 'Bottled water', 'Museum entry'],
    exclusions: ['Food and drinks beyond water', 'Tips'],
    whatToBring: ['Comfortable walking shoes', 'Hat and sunscreen', 'Light, breathable clothes'],
    faqs: [
      {
        question: 'What should I wear?',
        answer:
          'Light, breathable clothes and comfortable walking shoes. Lagos is hot, so bring a hat and sunscreen. Shoulders covered is respectful inside the Cathedral.',
      },
      {
        question: 'Is the walk suitable for children?',
        answer:
          'Yes, children 3 and up enjoy it. Infants are free in a carrier; the route is not buggy-friendly.',
      },
    ],
    prices: categories({ adult: 25000, child: 12500 }),
    addOns: [],
  },
  {
    slug: 'lagos-street-food-crawl',
    activityLabel: 'Evening',
    arriveMinutesEarly: 10,
    // Thursday to Saturday evenings.
    schedule: { daysOfWeek: [4, 5, 6], times: ['18:30'] },
    title: 'Lagos Street Food Crawl',
    summary: 'An evening of suya, boli, amala and puff-puff across Yaba and Surulere.',
    description:
      'Eat your way through Lagos after dark. Your guide leads you to trusted local spots in Yaba and Surulere for smoky suya, roasted plantain (boli) with groundnuts, amala with ewedu and gbegiri, and warm puff-puff to finish. Tell us about dietary needs when you book and we will plan around them.',
    status: 'published',
    durationMinutes: 210,
    defaultCapacity: 10,
    meetingPoint: {
      name: 'Yaba Tech main gate',
      address: 'Herbert Macaulay Way, Yaba',
      lat: 6.5173,
      lng: 3.3739,
    },
    stops: [
      { name: 'Suya spot, Yaba', description: 'Spiced grilled beef straight off the fire.' },
      { name: 'Boli and groundnut corner', description: 'Roasted plantain, a Lagos classic.' },
      { name: 'Amala joint, Surulere', description: 'Amala with ewedu and gbegiri.' },
      { name: 'Puff-puff stand', description: 'Sweet fried dough to end the night.' },
    ],
    inclusions: ['Four food tastings', 'One soft drink', 'Local guide'],
    exclusions: ['Alcoholic drinks', 'Transport to the meeting point'],
    whatToBring: ['An appetite', 'Cash for extra snacks', 'Hand sanitiser'],
    faqs: [
      {
        question: 'Can you cater for vegetarians or allergies?',
        answer:
          'Yes. Add dietary needs for each traveller when you book and we will arrange alternatives. Some stops cook near groundnuts.',
      },
    ],
    prices: categories({ adult: 35000, child: 20000 }),
    addOns: [
      {
        name: 'Extra tasting plate',
        description: 'A fifth stop for asun (spicy goat) or nkwobi.',
        priceKobo: nairaToKobo(5000),
        // The vendor prepares a limited number each night.
        stockPerDeparture: 10,
        sortOrder: 0,
      },
      {
        name: 'Palm wine sampler',
        description: 'Fresh palm wine in a calabash (18+ only).',
        priceKobo: nairaToKobo(4000),
        stockPerDeparture: 10,
        sortOrder: 1,
      },
    ],
  },
  {
    slug: 'lekki-nature-and-craft',
    activityLabel: 'Van, pickup',
    // Wednesday and Saturday mornings.
    schedule: { daysOfWeek: [3, 6], times: ['08:00'] },
    title: 'Lekki Nature and Craft Half-Day',
    summary:
      'Canopy walk at the Lekki Conservation Centre and an hour at the Lekki Arts and Crafts Market, with hotel pickup.',
    description:
      'Swap traffic for treetops. We collect you from Victoria Island, Ikoyi or Lekki in an air-conditioned van, head to the Lekki Conservation Centre for its famous canopy walkway and wildlife trails, then browse handmade textiles, carvings and beads at the Lekki Arts and Crafts Market before dropping you back.',
    status: 'published',
    durationMinutes: 300,
    defaultCapacity: 12,
    meetingPoint: {
      name: 'Hotel pickup (or meet at the Conservation Centre gate)',
      address: 'Lekki Conservation Centre, Lekki-Epe Expressway',
      lat: 6.4419,
      lng: 3.5354,
    },
    pickupPoints: [
      // Landmarks and times from the checkout design (stage 12c).
      { name: 'Victoria Island', address: 'Eko Hotel main gate', time: '07:15' },
      { name: 'Ikoyi', address: 'Falomo roundabout', time: '07:30' },
      { name: 'Lekki Phase 1', address: 'Admiralty Way gate', time: '07:45' },
    ],
    stops: [
      { name: 'Lekki Conservation Centre', description: 'Canopy walkway and nature trails.' },
      { name: 'Lekki Arts and Crafts Market', description: 'Handmade crafts, fabrics and art.' },
    ],
    inclusions: ['Air-conditioned van with driver', 'Guide', 'Conservation Centre entry'],
    exclusions: ['Canopy walk fee (paid at the gate)', 'Market purchases'],
    whatToBring: ['Closed shoes', 'Insect repellent', 'Cash for the market'],
    faqs: [],
    prices: categories({ adult: 45000, child: 25000 }),
    addOns: [],
  },
  {
    slug: 'tarkwa-bay-beach-and-lagoon',
    activityLabel: 'Boat',
    arriveMinutesEarly: 15,
    // Weekends only.
    schedule: { daysOfWeek: [0, 6], times: ['10:00'] },
    title: 'Tarkwa Bay Beach and Lagoon Trip',
    summary: 'A weekend boat ride across the Lagos lagoon to the sheltered beach at Tarkwa Bay.',
    description:
      'Leave the city behind on a chartered boat across the Lagos lagoon to Tarkwa Bay, a sheltered beach popular for swimming. Life jackets are provided. Trips depend on the weather: if the lagoon is unsafe we cancel and refund under our cancellation policy.',
    status: 'published',
    durationMinutes: 360,
    defaultCapacity: 12,
    meetingPoint: {
      name: 'Jetty, Victoria Island',
      address: 'Boat jetty, Victoria Island waterfront',
      lat: 6.4253,
      lng: 3.4105,
    },
    stops: [
      { name: 'Lagos lagoon crossing', description: 'Views of the city skyline from the water.' },
      { name: 'Tarkwa Bay beach', description: 'Sheltered swimming and relaxing.' },
    ],
    inclusions: ['Return boat ride', 'Life jackets', 'Guide'],
    exclusions: ['Food and drinks', 'Beach chairs (available as an add-on)'],
    whatToBring: ['Swimwear and towel', 'Sunscreen', 'A waterproof bag for your phone'],
    faqs: [
      {
        question: 'What happens if the weather is bad?',
        answer:
          'If the lagoon is unsafe we cancel the trip and you get a full refund, or you can move to another date.',
      },
    ],
    prices: categories({ adult: 40000, child: 22000 }),
    addOns: [
      {
        name: 'Beach chair and umbrella',
        description: 'Reserved under a shade umbrella for the day.',
        priceKobo: nairaToKobo(7500),
        stockPerDeparture: 6,
        sortOrder: 0,
      },
      {
        name: 'Packed lunch',
        description: 'Jollof rice, chicken and a drink.',
        priceKobo: nairaToKobo(8000),
        stockPerDeparture: null, // unlimited
        sortOrder: 1,
      },
    ],
  },
  {
    slug: 'badagry-heritage-day-trip',
    activityLabel: 'Van, full day',
    arriveMinutesEarly: 15,
    // Saturdays, early start.
    schedule: { daysOfWeek: [6], times: ['07:00'] },
    title: 'Badagry Heritage Day Trip',
    summary:
      'A full day in Badagry: the Point of No Return, the slave relics museum and the First Storey Building.',
    description:
      'A thoughtful day trip west of Lagos to Badagry, a town at the centre of the Atlantic slave trade. Visit the slave relics museum, walk the path to the Point of No Return, and see the First Storey Building in Nigeria. Secure your place with a 30% deposit and pay the balance before the trip.',
    status: 'published',
    durationMinutes: 600,
    defaultCapacity: 14,
    // 30% now, the balance 7 days before the trip (stage 11c).
    depositBasisPoints: 3000,
    meetingPoint: {
      name: 'Ìrìn office, Yaba',
      address: 'Commercial Avenue, Yaba',
      lat: 6.5095,
      lng: 3.3711,
    },
    stops: [
      { name: 'Slave relics museum', description: 'Artefacts and history of the trade.' },
      { name: 'Point of No Return', description: 'The walk to the shore, and the memorial.' },
      { name: 'First Storey Building in Nigeria', description: 'Built in 1845.' },
    ],
    inclusions: ['Return van transport', 'Guide', 'Museum and site entry'],
    exclusions: ['Lunch (available as an add-on)', 'Tips'],
    whatToBring: ['Comfortable shoes', 'Water', 'Hat and sunscreen'],
    faqs: [
      {
        question: 'How does the deposit work?',
        answer:
          'Pay 30% to book. We send reminders before the balance is due, with a link to pay the rest.',
      },
    ],
    prices: categories({ adult: 65000, child: 35000 }),
    addOns: [
      {
        name: 'Lunch in Badagry',
        description: 'A local lunch with a soft drink.',
        priceKobo: nairaToKobo(8000),
        stockPerDeparture: null,
        sortOrder: 0,
      },
    ],
  },
];
