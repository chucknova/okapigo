# Stage 11a: The public catalogue

**Session 11** gives the guest web its backend, before any screens exist (the screens wait for
your designs from `docs/flows/`). It is split into stages:

| Stage   | What                                                                                  | PRD            |
| ------- | ------------------------------------------------------------------------------------- | -------------- |
| **11a** | **Public tour list, tour page, bookable dates**                                       | BKG-32 (read)  |
| 11b     | Public quote, hold and booking (channel "web"), adult rule, pickup point, rate limits | BKG-02, INV-23 |
| 11c     | Deposit rules per tour, and starting a guest payment                                  | BKG-06, PAY-02 |
| 11d     | Balance reminders and overdue alerts                                                  | BKG-06         |
| 11e     | Link previews (title, image, price when shared)                                       | BKG-32         |

## 1. What we built

Three read-only endpoints that anyone can call without signing in:

| Endpoint                                                 | Feeds                               | Cached?          |
| -------------------------------------------------------- | ----------------------------------- | ---------------- |
| `GET /public/:operatorSlug`                              | tour cards: catalogue page, website | 60 s             |
| `GET /public/:operatorSlug/tours/:tourSlug`              | the tour page and checkout's prices | 60 s             |
| `GET /public/:operatorSlug/tours/:tourSlug/departures?…` | the date picker (checkout screen 1) | never (no-store) |

Files:

- `apps/api/src/routes/public-catalogue.js`: the router and its guest-only serializers
- `apps/api/src/lib/date-range.js`: `?from&to` parsing, now shared by staff and public routes
- `packages/shared/src/catalogue.js`: `fromPriceKobo()`, the "from ₦…" rule
- `apps/api/test/public-catalogue.test.js`: 11 tests

## 2. How it works

```
browser ──GET /public/irin-lagos-tours──► find operator by slug (404 if none)
                                          published tours only
                                          one SQL query: each tour's next date with a seat
                                          ◄── { operator, tours: [card…] }   Cache-Control: 60 s
```

**Every URL starts with the operator's slug.** The slug is how the public names a business (it's
in their booking links), so it's also how these routes find the tenant. Every query after that is
filtered by that operator's id, exactly like the staff API filters by the signed-in user's
operator. A test seeds two operators with identical tour slugs and checks that no departure
from the other one leaks through.

**"Not published" looks exactly like "doesn't exist".** A draft tour answers the same 404, with
the same body, as a slug nobody ever used. If it answered "403 this tour is a draft", anyone could
probe slugs to find out what an operator is preparing.

**Guest serializers are a separate whitelist.** The staff `serializeProduct` sends the product's
id, status, capacity, policy id and more. The public serializers are written out field by field,
so adding a column to `products` can never make it public by accident. Departures show
`seatsAvailable` and `soldOut`, but **not** `seatsSold`, `seatsHeld` or `capacity`: how well a
tour sells is commercial information.

**The "from" price** (`fromPriceKobo`): the cheapest active open-ended category (the "adult"
style price, where `maxAge` is null), falling back to the cheapest paid price. "From ₦12,500" (a
child's price) would mislead an adult reading the card, and "from ₦0" (infants) is useless.

**The next date, in one query.** Cards show each tour's next date with a free seat. Asking once
per tour would be 5 queries (the "N+1" problem: one query for the list, then one per row). Instead:

```sql
SELECT DISTINCT ON (product_id) product_id, starts_at, capacity - seats_sold - seats_held
  FROM departures
 WHERE operator_id = $1 AND status = 'scheduled' AND starts_at > now()
   AND capacity - seats_sold - seats_held > 0
 ORDER BY product_id, starts_at
```

`DISTINCT ON (product_id)` is a PostgreSQL feature: keep only the **first** row for each
product_id, in the `ORDER BY` order. Ordered by start time, the first row is the earliest. This is
raw SQL because Prisma's query builder can't compare one column with another
(`capacity > seats_sold + seats_held`).

**Sold-out dates stay in the date list**, marked `soldOut: true`, so the calendar can grey them
out. A date that silently disappears makes guests think the tour doesn't run that day.

**Caching.** `Cache-Control: public, max-age=60` lets the browser (and a CDN later) reuse tour
content for a minute without asking again: less data on a slow, expensive connection. Seat counts
get `no-store`, because a stale "3 seats left" causes a failed hold later. (A hold always checks
seats under a row lock anyway, so a stale count can never oversell. It would only disappoint.)

## 3. Why we chose what we chose

| Choice                                      | Alternative                       | Why                                                                                 |
| ------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `/public/...` routes outside `/api`         | `/api/public/...` with exceptions | `/api` stays default-deny with no exceptions; the public surface is easy to audit   |
| Separate guest serializers                  | Reuse staff serializers + delete  | A whitelist fails safe: new columns stay private until someone adds them on purpose |
| Moving `dateRange` into `lib/date-range.js` | Copying it                        | Guest and staff calendars must follow the same defaults and limits                  |
| Policy terms included on the tour page      | A separate policy endpoint        | Guests must see cancellation terms before they pay; one request fewer on 3G         |

## 4. Concepts to study

- **Information disclosure** and why 404 beats 403 for hidden resources (OWASP)
- **HTTP caching**: `Cache-Control`, `max-age`, `no-store` vs `no-cache` (MDN has a good guide)
- **N+1 queries** and how to spot them
- PostgreSQL **`DISTINCT ON`**

## 5. Try it yourself

With `pnpm dev` running (the demo operator's slug is `irin-lagos-tours`):

```bash
curl -s localhost:4000/public/irin-lagos-tours | jq '.tours[] | {title, fromPriceKobo, nextDeparture}'
```

```bash
curl -s localhost:4000/public/irin-lagos-tours/tours/badagry-heritage-day-trip | jq '.tour.priceCategories'
```

```bash
curl -si "localhost:4000/public/irin-lagos-tours/tours/lagos-street-food-crawl/departures" | head -20
```

Look for the `Cache-Control` header in the last one. Then mark a tour as draft through the staff
API and watch it vanish from the first command.

## 6. Gotchas

- Raw SQL returns PostgreSQL `bigint`/numeric results as JavaScript `BigInt` or strings, so
  `seats_available` is wrapped in `Number(...)` before it's sent.
- `max-age=60` means an operator who edits a tour's price may see the old price on the public
  page for up to a minute. **The checkout always prices from the database**, so a guest pays the
  current price (stage 11b). The cache only affects what the page displays.
- Bookings can be made right up to departure time. A cutoff ("stop selling 2 hours before") is in
  the parking lot.

## 7. What's next

**Stage 11b:** the public quote, hold and booking. A guest's browser will **write** for the first
time, so it also brings per-IP rate limiting (in the parking lot since session 3). Without it,
someone could hold every seat on a departure, again and again.
