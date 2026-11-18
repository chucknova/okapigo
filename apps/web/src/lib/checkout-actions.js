// @ts-check
/**
 * checkout-actions.js — the two things checkout ASKS the server to do, shared by steps 3
 * and 4 (step 4's "Hold my seats again" makes the same booking as step 3).
 *
 *   holdAndBook()  POST /public/:operator/bookings  → seats held 15 min + a booking (held)
 *   startPayment() POST /public/bookings/:token/pay → Paystack's address to go to
 */
import { api } from './api.js';
import { addOnSelections, basketKey } from './checkout.js';

/**
 * Holds the seats and creates the booking from what the guest entered. If an older booking
 * from this checkout is still held, its seats are given back first (the guest went back and
 * changed something), so one guest never holds two sets of seats.
 * @param {string} operatorSlug
 * @param {any} state  the checkout state (date, counts, extras, pickup, lead, travellers)
 * @param {Array<{ categoryKey: string }>} slots  from travellerSlots()
 * @returns {Promise<{ token: string, key: string }>}
 */
export async function holdAndBook(operatorSlug, state, slots) {
  if (state.booking?.token) {
    // Best effort: if this fails, the old hold simply expires in a few minutes.
    await api(`/public/bookings/${state.booking.token}/release`, { method: 'POST' }).catch(
      () => {},
    );
  }
  const result = await api(`/public/${encodeURIComponent(operatorSlug)}/bookings`, {
    method: 'POST',
    body: {
      departureId: state.departure.id,
      lead: {
        name: state.lead.name,
        email: state.lead.email,
        phone: state.lead.phone,
        acceptTerms: true,
        marketingConsent: state.lead.marketingConsent,
      },
      travellers: state.travellers.map((t, i) => ({
        name: t.name,
        age: Number(t.age),
        dietaryNeeds: t.dietaryNeeds,
        // The counter it came from: the server checks the age fits (or says which to pick).
        categoryKey: slots[i].categoryKey,
      })),
      addOns: addOnSelections(state.addOns),
      pickupPoint: state.pickup,
    },
  });
  return { token: result.token, key: basketKey(state) };
}

/**
 * Asks for a Paystack checkout for the chosen option ("full" or "deposit"). The server works
 * out the amount; the browser never sends one.
 * @param {string} token
 * @param {'full' | 'deposit'} option
 * @returns {Promise<string>}  the address to send the guest to
 */
export async function startPayment(token, option) {
  const { payment } = await api(`/public/bookings/${token}/pay`, {
    method: 'POST',
    body: { option, method: 'any' },
  });
  return payment.authorizationUrl;
}
