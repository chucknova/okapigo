# Session 4: The catalogue. Products, prices and add-ons

**PRD coverage:** **INV-01** (product catalogue), **INV-05** (adult/child/infant prices with age
rules) and **INV-10** (add-ons with their own price and stock). Build step 2, part 1 of 2.

**Roadmap change:** the original session 4 also covered schedules. Turning "daily at 9am except
25 December" into real dated departures in Lagos time is a full topic of its own, so it moved to
**session 5**. The roadmap now has 19 sessions.

**Done when:** Ìrìn's five tours are seeded and readable through the API with correct prices,
and owners can create, price and publish tours. ✅ 138 tests across the repo.

---

## 1. What we built

```
packages/db/
├── prisma/schema.prisma          + Product, PriceCategory, AddOn
├── prisma/migrations/…_add_catalogue/   (with CHECK constraints)
└── src/seed/tours.js             the five tours' content, prices and add-ons

packages/shared/src/
├── money.js                      nairaToKobo(), formatNaira()
├── catalogue.js                  findAgeOverlap(), findCategoryForAge()
└── schemas/products.js           Zod: products, meeting points, stops, photos, prices, add-ons

apps/api/src/routes/products.js   the catalogue API (8 endpoints)
```

### The five tours (illustrative prices)

| Tour                        | Adult   | Child   | Seats | Add-ons                                                                    |
| --------------------------- | ------- | ------- | ----- | -------------------------------------------------------------------------- |
| Lagos Island Heritage Walk  | ₦25,000 | ₦12,500 | 15    | —                                                                          |
| Lagos Street Food Crawl     | ₦35,000 | ₦20,000 | 10    | Extra tasting plate ₦5,000 (10/night), Palm wine sampler ₦4,000 (10/night) |
| Lekki Nature and Craft      | ₦45,000 | ₦25,000 | 12    | — (has 3 pickup points)                                                    |
| Tarkwa Bay Beach and Lagoon | ₦40,000 | ₦22,000 | 12    | Beach chair ₦7,500 (6/trip), Packed lunch ₦8,000 (unlimited)               |
| Badagry Heritage Day Trip   | ₦65,000 | ₦35,000 | 14    | Lunch ₦8,000                                                               |

Infants (0–2) are free on every tour. Age bands: adult 13+, child 3–12, infant 0–2.

### The endpoints

| Endpoint                                                                     | Permission     |
| ---------------------------------------------------------------------------- | -------------- |
| `GET /api/products` (`?status=published`) and `GET /api/products/:id`        | products: view |
| `POST /api/products`, `PATCH /api/products/:id`                              | products: edit |
| `POST /api/products/:id/price-categories`, `PATCH /api/price-categories/:id` | products: edit |
| `POST /api/products/:id/add-ons`, `PATCH /api/add-ons/:id`                   | products: edit |

Guides and managers can view; only the owner (or a custom role with products: edit) can change.

## 2. How it works

### Money is integer kobo, everywhere

```
Seed/UI says  ₦25,000  ──nairaToKobo──►  2500000  ──stored/sent/calculated──►  2500000  ──formatNaira──►  "₦25,000"
              (people)                    (integer kobo: the only form inside the system)              (people)
```

Floats can't hold most decimals exactly: `0.1 + 0.2` is `0.30000000000000004`, and
`99.99 * 100` is `9998.999999999998`. Integers of kobo are always exact. Every money field ends
in `Kobo` so you can't mistake its unit, Zod rejects non-integers (`2500.5` → 400), and the
database rejects negatives.

### Age bands: one price per age, no ambiguity

Each price category covers an inclusive range (`minAge`–`maxAge`, with `null` meaning "and
older"). Two rules, in `packages/shared/src/catalogue.js`:

1. **No overlaps** among a product's active categories. Adding "teen 12–17" next to "child 3–12"
   is refused (409 `AGE_RANGE_OVERLAP`), because a 12-year-old would match both.
2. `findCategoryForAge(categories, age)` returns the one category covering an age. The pricing
   pipeline in session 6 uses it for every traveller.

Gaps are allowed: a tour with no infant category simply doesn't take infants.

### JSON columns, validated by Zod

`meetingPoint`, `stops`, `photos`, `pickupPoints` and `faqs` are JSONB. They're always read as a
whole (by the website, trip hub and AI companion) and never searched field by field, so a table
for each would add joins for nothing. The database doesn't check their shape, so **every write
goes through the Zod schemas** in `schemas/products.js`. Photos _must_ have alt text, for
accessibility.

### Archive, don't delete

Price categories and add-ons have `isActive` and no DELETE endpoint. From session 7, bookings
point at them, and deleting "Child ₦12,500" would leave old bookings pointing at nothing. Products
retire with `status: "archived"`. Two guardrails:

- a product can't be **published** without at least one active price (`NOT_READY_TO_PUBLISH`)
- the **last** active price of a published product can't be archived

### Nested writes in Prisma

The seed creates a product and its children in one call:

```js
tx.product.create({
  data: {
    ...product,
    operator: { connect: { id: operator.id } },
    priceCategories: { create: prices }, // children get productId AND operatorId filled in
    addOns: { create: addOns },
  },
});
```

## 3. Why we chose what we chose

| Choice                             | Why                                                                        | Trade-off                                                  |
| ---------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Integer kobo**                   | Exact arithmetic; the ledger must balance to the kobo.                     | Every display needs `formatNaira()`.                       |
| **`Int`, not `BigInt`**            | Up to ~₦21.4M per value is plenty for a price, and JS handles it natively. | Ledger _totals_ may need BigInt later (session 8 decides). |
| **JSONB for content lists**        | Read whole, never queried inside; simpler than 5 extra tables.             | Shape enforced by Zod, not the database.                   |
| **Composite FKs on children**      | A price or add-on can't belong to another operator's product (tested).     | `operatorId` on every child row.                           |
| **Archive, not delete**            | Booking history stays intact.                                              | Lists need an `isActive` filter.                           |
| **`stockPerDeparture` on add-ons** | The food vendor makes 10 extra plates _a night_, not 10 ever.              | Counting sold stock waits for bookings (session 7).        |
| **Stable sort with tie-breakers**  | Rows with equal `sortOrder` came back in random order (see Gotchas).       | —                                                          |
| **`timestamptz` for new tables**   | Makes "this is UTC" explicit in raw SQL.                                   | Older tables use `timestamp`; both are UTC in practice.    |

## 4. Concepts to study

- **Floating-point representation** (IEEE 754) and why money uses integers.
- **`Intl.NumberFormat`**: locale-aware currency formatting.
- **Interval overlap**: `a.min <= b.max && b.min <= a.max`.
- **JSONB vs normalised tables**: when each fits.
- **PostgreSQL arrays** (`TEXT[]`).
- **Soft delete / archiving** vs hard delete.
- **Non-deterministic ordering**: SQL guarantees no order without `ORDER BY`, and no order
  _among ties_ even with it.
- **Flaky tests** and how to hunt them.

## 5. Try it yourself

First get the tours into your local database (this wipes and reseeds it):

```bash
pnpm db:reset
pnpm dev
```

Sign in as Adaeze (owner) as in session 3, then:

```bash
T='Authorization: Bearer <token>'
curl -s localhost:4000/api/products -H "$T" | python3 -m json.tool | less
curl -s 'localhost:4000/api/products?status=published' -H "$T" | python3 -c "import sys,json; [print(p['title'], [c['amountKobo'] for c in p['priceCategories']]) for p in json.load(sys.stdin)['products']]"
```

Experiments:

1. Create a draft tour (the body in `apps/api/test/products.test.js` → `NEW_TOUR`) and try to
   publish it before adding a price.
2. Add a "teen" price for ages 12–17 to the Heritage Walk and read the 409.
3. In Node: `node -e "console.log(0.1 + 0.2, 99.99 * 100)"`. That's why we use kobo.
4. `pnpm db:studio` and look at `meeting_point` and `stops`: JSON inside a column.
5. Sign in as Kemi (guide): she can list products but `POST /api/products` gives 403.

## 6. Gotchas

- **A flaky test found a real bug.** One test failed once in six runs. The cause: two prices
  both had `sortOrder: 0`, and **PostgreSQL returns tied rows in no guaranteed order**. The test
  wasn't wrong; the API was, because a price list could reshuffle between page loads. Fix: sort
  by `sortOrder`, then `createdAt`, then `id`. Lesson: never ignore a flaky test. It's usually
  telling you something true.
- **Prisma nested writes:** children get _both_ relation fields (`productId`, `operatorId`) from
  the parent, so passing `operatorId` on a child is an error. And with nested writes the parent
  must use `operator: { connect: … }`, not a raw `operatorId`.
- **Proving tests can fail, again.** I removed the tenant filter from `findOwnProduct` and the
  isolation test failed, as it should.
- **Your local database needs `pnpm db:reset`** to get the tours (your current Ìrìn copy was
  seeded before tours existed).

## 7. What's next: session 5

**Schedules and departures (INV-03).** Daily, weekly and custom departure rules with per-date
exceptions, turned into real departures (with capacity, seats sold, seats held) for the next
60 days, all in Lagos time, plus an availability endpoint. That completes build step 2:
"seeded tours show correct prices and availability through the API".
