// @ts-check
/** A small offline package, shaped like the server's (stage 15b), for the tests. */

/** @param {string} id @param {number} position @param {string} name @param {Partial<any>} [o] */
const traveller = (id, position, name, o = {}) => ({
  id,
  position,
  name,
  displayName: name,
  category: { key: 'adult', name: 'Adult' },
  age: null,
  dietaryNeeds: '',
  checkInStatus: 'pending',
  checkedInAt: null,
  ...o,
});

export const TZ = 'Africa/Lagos';

export function makePackage() {
  return {
    operator: { name: 'Ìrìn Lagos Tours', timeZone: TZ, phone: '+2348030000000' },
    days: ['2026-12-05', '2026-12-06'],
    departures: [
      {
        departure: {
          id: 'dep-badagry',
          status: 'scheduled',
          startsAt: '2026-12-05T06:00:00.000Z',
          endsAt: '2026-12-05T16:00:00.000Z',
          localDate: '2026-12-05',
          localTime: '07:00',
          capacity: 14,
          notes: 'Driver: Sola',
        },
        tour: { title: 'Badagry Heritage Day Trip', meetingPoint: { name: 'Ìrìn office, Yaba' } },
        guide: { id: 'u-femi', name: 'Femi' },
        resource: { id: 'r-van1', kind: 'van', name: 'Van 1', seats: 14 },
        counts: {},
        bookings: [
          {
            id: 'b-okafor',
            reference: 'ILT-7Q2LKD',
            status: 'paid',
            lead: { name: 'Adaeze Okafor', phone: '+2348031234567' },
            money: { owedKobo: 0, label: 'Paid' },
            travellers: [
              traveller('t-adaeze', 1, 'Adaeze Okafor'),
              traveller('t-chidi', 2, 'Chidi Okafor'),
              traveller('t-kamsi', 3, 'Kamsi Okafor', { dietaryNeeds: 'No peanuts' }),
            ],
          },
          {
            id: 'b-nwosu',
            reference: 'ILT-5PX9TN',
            status: 'paid',
            lead: { name: 'Emeka Nwosu', phone: '+2348124447781' },
            money: { owedKobo: 0, label: 'Paid' },
            travellers: [
              traveller('t-emeka', 1, 'Emeka Nwosu'),
              traveller('t-guest2', 2, '', { displayName: 'Guest 2 of Emeka Nwosu’s booking' }),
            ],
          },
          {
            id: 'b-bayo',
            reference: 'ILT-9GT4VA',
            status: 'cancelled',
            lead: { name: 'Bayo Adewale', phone: '+2348030000009' },
            money: { owedKobo: 0, label: 'Paid' },
            travellers: [traveller('t-bayo', 1, 'Bayo Adewale')],
          },
        ],
      },
    ],
  };
}
