# Stage 17a: the OCTO API, catalogue side

Session 17 lets online travel agencies (**OTAs**: Viator, GetYourGuide, and our mock OTA) sell
Ìrìn's tours. In four parts (decided 2026-11-21):

| Part    | What                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------- |
| **17a** | **OCTO catalogue: supplier, products, units, availability, the calendar; channel keys; contract tests** |
| 17b     | OCTO bookings: hold, confirm, cancel; the booking's channel and money; no oversell across channels      |
| 17c     | The channel manager: Settings › Channels, tours per channel, keys, the 60-second webhook                |
| 17d     | The mock OTA app and journey 3                                                                          |

Also decided: **the OTA takes the guest's money** and owes Ìrìn the price minus its commission;
the mock OTA's screens and Settings › Channels are **yours to design**: the brief is
[`docs/flows/08-octo-and-channels.md`](../flows/08-octo-and-channels.md).

## 1. What OCTO is

**OCTO** (Open Connectivity for Tours, Activities and Attractions) is an open standard for how a
reseller talks to a tour operator's booking system: one set of endpoints and shapes, so an OTA
that speaks OCTO can sell any supplier that speaks it, without a custom integration each time.
We're the **supplier**; the OTA is the **reseller**. The spec lives at docs.octo.travel.

## 2. What we built

| Piece                                               | Where                                    |
| --------------------------------------------------- | ---------------------------------------- |
| Channels and the tours each may sell (a migration)  | `channels`, `channel_products` tables    |
| Keys: made, hashed, looked up                       | `packages/db/src/channels.js`            |
| The OCTO shapes, as schemas (the contract)          | `packages/shared/src/octo.js`            |
| Our tours, prices, departures as OCTO               | `apps/api/src/octo/views.js` (pure)      |
| The endpoints                                       | `apps/api/src/octo/router.js` at `/octo` |
| The mock OTA's channel in the seed (all tours, 20%) | `packages/db/src/seed/demo-operator.js`  |

| Endpoint                           | Answers                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `GET /octo/supplier`               | the business: name, endpoint, contact                        |
| `GET /octo/products`               | the tours this channel may sell (published)                  |
| `GET /octo/products/:id`           | one of them                                                  |
| `POST /octo/availability`          | departures and seats left: a date range, or availability ids |
| `POST /octo/availability/calendar` | day by day: open or closed, the most seats left              |

## 3. Our model in OCTO's words

| Ours                       | OCTO                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| a tour                     | a **Product**, with one **Option** ("DEFAULT": the tour as sold)                                 |
| a price category           | a **Unit** (`adult` → ADULT, `child` → CHILD, `infant` → INFANT; 60+ with no upper age → SENIOR) |
| "children need an adult"   | the unit's `accompaniedBy: ["adult"]`                                                            |
| a departure                | an **Availability** (its id is the departure's id)                                               |
| seats left                 | `vacancies`; `SOLD_OUT` at 0, `LIMITED` under half, else `AVAILABLE`                             |
| the free-cancellation tier | the option's `cancellationCutoff` ("48 hours before the start")                                  |
| the price a guest pays     | **Pricing** `retail` (kobo, tax included), `net` = retail − the OTA's commission                 |

## 4. One stock, one price

- **Seats**: availability is read with the same `listAvailability` and `seatsLeft` as the
  website and WhatsApp. A website hold lowers OCTO's vacancies at once (tested): there's one
  departure row, not a copy per channel.
- **Prices**: OCTO prices come from the same pricing pipeline (`priceBasket`). A test asks the
  website's quote and OCTO's availability for the same party and checks the totals match. The
  tax inside each price is listed (`includedTaxes`), in whole naira like every percentage.

## 5. Keys

Each channel has its own API key, `octo_` + 32 random bytes. **Only its SHA-256 is stored**
(and its last 4 characters, to tell keys apart): a leaked database hands nobody a working key.
SHA-256 suits here, unlike for passwords, because a random 32-byte key can't be guessed. The key
decides the business and which tours can be seen: another business's tour is simply "invalid",
never "not yours".

The seed gives the demo business a **Mock OTA** channel selling every tour at 20%, with a fixed
dev key (`octo_dev_<business slug>`, or `MOCK_OTA_API_KEY` from the settings): the mock OTA app
(17d) uses it. **Your dev database gets it only after `pnpm db:reset`.**

## 6. The contract

`packages/shared/src/octo.js` writes OCTO's shapes as schemas, with the spec's easy-to-miss
rules: keys that must be present **even when null** (`reference`, `vacancies`, every contact
field), `utcCutoffAt` never null, at least one start time, all seven unit restrictions, the
lowercase cutoff unit, `original ≥ retail`. The contract tests check **every answer** against
them. Extra fields aren't refused: capabilities add fields, and OTAs must ignore unknown ones.

### Where the docs contradict themselves (our choices)

| The docs say                                                                                       | We do                                                                                         |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Errors: "always 400" (the error page, the schemas) vs "a bad key is 403" (the authentication page) | **400** for request errors; **401** without a key; **403** for an unknown or switched-off key |
| The pricing capability is `pricing` or `octo/pricing`                                              | **both** accepted; we answer `octo/pricing`                                                   |
| Spec paths end in `/` (`/products/`), the text's don't                                             | **both** work (Express isn't strict)                                                          |

Errors keep OCTO's shape everywhere under `/octo`, even a body that isn't JSON: the OCTO
router reads its own JSON, before the app's reader (which would answer in OkapiGo's shape).

## 7. Tests

- `apps/api/test/octo-catalogue.test.js` (9): who may ask; the supplier; the products (every one
  conforming; units; cancellation cutoff); prices (retail, net after 20%, the tax inside; the
  `pricing` alias); one product (another business's, a draft, off the channel: invalid); a
  date range (the website's hold counts; not enough seats; sold out); by id with prices = the
  website's quote; errors in OCTO's shape; the calendar (every day; CLOSED days).
- `apps/api/test/octo-views.test.js` (7): unit types, status, local times with offsets (Lagos,
  New York, Kolkata), the cutoff, pricing, availability, keys.
- Mutation checks: 22 changes; 4 survived at first. Three got tests (a departure that has
  started can't be asked about by id; the calendar's "available" counts the whole party; a tour
  with no schedule still has a start time, the spec's minimum) and one check was removed because
  it couldn't change an answer (a key without the `octo_` prefix is refused by the lookup anyway).
- Checked on the real server (your dev database, no OTA channel yet): no key → 401
  UNAUTHORIZED, a wrong key → 403 FORBIDDEN, both in OCTO's shape with the `Octo-Capabilities`
  header; the operator app and the catalogue still answer.
