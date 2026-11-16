# Session 6: The pricing pipeline

**PRD coverage:** **INV-24**: one fixed calculation order (base, category, add-ons, promo,
fees, tax) in a shared package, with naira rounding rules; identical results on every channel,
covered by unit tests.

**Roadmap change:** the original session 6 also had checkout holds, background jobs and the
concurrency tests. Those are the PRD's highest-stakes feature ("no double-selling"), so they now
get **session 7** to themselves. The roadmap is 20 sessions.

**Done when:** every price is computed by one tested function; staff can request a quote for any
basket through the API. ✅ 207 tests across the repo, including 500 generated baskets.

---

## 1. What we built

```
packages/shared/src/
├── pricing.js            priceBasket(): THE pipeline. percentOf(), divideRoundToNaira()
└── schemas/pricing.js    Zod: operator tax/fee settings, quote request

packages/db/              operators.pricing (JSONB): { tax, fees }. Default: VAT 7.5% included

apps/api/src/
├── pricing/quote-service.js   loads prices + settings from the DB, then calls priceBasket()
└── routes/quotes.js           POST /api/quotes (products: view)
```

## 2. How it works

### The pipeline, in its fixed order

```
 travellers ─► 1. TICKETS    each traveller → price category (by age), grouped per category
 add-ons    ─► 2. ADD-ONS    unit price × quantity
                ─────────── SUBTOTAL
 promo      ─► 3. DISCOUNT   percent or fixed, never more than the subtotal
 fees       ─► 4. FEES       on the DISCOUNTED amount
 tax        ─► 5. TAX        on (discounted + fees): included in prices, or added on top
                ─────────── TOTAL
```

The order matters. A 2.5% fee on ₦85,000 is ₦2,125, but on the discounted ₦76,500 it's
₦1,913. If two channels did it in different orders, the same basket would cost two different
amounts. One function, imported everywhere, makes that impossible.

### A worked example (it's a test)

Street Food Crawl, 2 adults, 3 extra tasting plates, promo 10%, 2.5% service fee, 7.5% VAT
added on top:

| Step         | Calculation                                       | Amount      |
| ------------ | ------------------------------------------------- | ----------- |
| Tickets      | 2 × ₦35,000                                       | ₦70,000     |
| Add-ons      | 3 × ₦5,000                                        | ₦15,000     |
| **Subtotal** |                                                   | **₦85,000** |
| Promo        | 10% of ₦85,000                                    | −₦8,500     |
| Fee          | 2.5% of ₦76,500 = ₦1,912.50 → **rounded half up** | ₦1,913      |
| VAT          | 7.5% of ₦78,413 = ₦5,880.98 → rounded             | ₦5,881      |
| **Total**    | ₦78,413 + ₦5,881                                  | **₦84,294** |

### Rounding with integers only

Percentages are **basis points** (1 bp = 0.01%, so 7.5% = 750): integers, not `0.075`.
Each percentage result is rounded to the **nearest whole naira, halves up**:

```js
// round(n / d) using only integers: floor((2n + d) / 2d)
divideRoundToNaira(numerator, denominator)
percentOf(kobo, basisPoints) = divideRoundToNaira(kobo × basisPoints, 10,000)
```

No floating point anywhere, so no `0.1 + 0.2` drift.

### Tax included vs added

- **Included** (Ìrìn's default): prices already contain VAT. The pipeline works out the part
  that _is_ tax, for receipts: `gross × 7.5 / 107.5`. ₦62,500 contains ₦4,360 of VAT; the
  total stays ₦62,500.
- **Added**: VAT is put on top: `net × 7.5 / 100`.

The setting lives on the **operator** (`operators.pricing`), not in code, because it's a
business's own choice. The VAT treatment here is illustrative, not tax advice.

### Pure function + loader

`priceBasket()` knows nothing about databases. `quote-service.js` loads the product's **active**
prices and add-ons and the operator's settings, then calls it. Holds, bookings, the public
checkout and the OTA will all call `quote()`, so every channel agrees.

## 3. Why we chose what we chose

| Choice                                           | Why                                                                            | Trade-off                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **One pure function in `shared`**                | Same input, same output, on every channel; easy to test.                       | Callers must load data first (the quote service).                                  |
| **Round each percentage to whole naira**         | Guests never see "₦62,499.87"; totals stay tidy.                               | Up to ₦0.50 difference vs exact maths per step (deliberate and documented).        |
| **Half up**                                      | The rule people expect from school.                                            | Banker's rounding (half to even) is fairer over millions of sums; not needed here. |
| **Basis points**                                 | Integer rates, no float drift.                                                 | Must remember 750 = 7.5%.                                                          |
| **Promo is an input, no promo-code table yet**   | The pipeline needs the step (INV-24); managing codes isn't an MVP requirement. | Parked in `docs/parking-lot.md`.                                                   |
| **Invalid operator settings → 500, not a guess** | Quietly mis-pricing is worse than failing loudly.                              | —                                                                                  |

## 4. Concepts to study

- **Order of operations** in pricing (discount before or after tax and fees).
- **Rounding modes**: half up, half even (banker's), floor, ceiling.
- **Integer division tricks**: `floor((2n + d) / 2d)` = round half up.
- **Basis points.**
- **Tax-inclusive vs tax-exclusive pricing.**
- **Property-based testing**: checking rules that must hold for _any_ input (see the
  "500 random baskets" test, using a seeded generator so failures are reproducible).
- **Discriminated unions** in Zod (`z.discriminatedUnion('type', …)` for fees).

## 5. Try it yourself

```bash
pnpm dev
```

Sign in (any staff member: guides can quote), then:

```bash
T='Authorization: Bearer <token>'
# Find the Heritage Walk's id
curl -s localhost:4000/api/products -H "$T" | python3 -c "import sys,json; [print(p['id'], p['title']) for p in json.load(sys.stdin)['products']]"
# A family of four
curl -s -X POST localhost:4000/api/quotes -H "$T" -H 'content-type: application/json' \
  -d '{"productId":"<id>","travellers":[{"age":41},{"age":38},{"age":9},{"age":1}]}' | python3 -m json.tool
```

Experiments:

1. Quote an infant (`{"age":1}`) for a tour, then archive its infant price and quote again
   → `NO_PRICE_FOR_AGE`.
2. In `psql`, change Ìrìn's settings to add a fee and make VAT exclusive:
   ```sql
   UPDATE operators SET pricing = '{"tax":{"name":"VAT","basisPoints":750,"inclusive":false},"fees":[{"name":"Service fee","type":"percent","basisPoints":250}]}';
   ```
   Re-quote and check the numbers by hand.
3. **Break the order on purpose**: in `pricing.js`, compute fees on `subtotalKobo` instead of
   `discountedKobo` and run `pnpm --filter @okapigo/shared test`. Two tests fail. Undo with
   `git checkout packages/shared/src/pricing.js`.

## 6. Gotchas

- **Tests proven to bite:** charging fees before the discount, and rounding halves down, were
  each caught by the tests.
- **Reuse, don't re-implement:** the first draft had its own age-matching loop. It now calls
  `findCategoryForAge` from `catalogue.js`, so the catalogue and pricing can't disagree about
  which price a 12-year-old pays.
- **No reset needed this time:** the new `pricing` column has a default, so existing operators
  got "VAT 7.5% included, no fees" automatically.
- **Session 5's push didn't reach GitHub** (local `main` was 4 commits ahead). If `git push`
  printed an error, it's usually authentication. Run it again and read the message.

## 7. What's next: session 7

**Checkout holds and zero oversells (INV-02, INV-23).** Holding seats **locks the departure
row** (`SELECT … FOR UPDATE`) inside a transaction while it counts; holds expire and a **BullMQ**
background job (Redis) releases them; another job rolls the 60-day schedule window forward; and
concurrency tests fire dozens of simultaneous holds at one departure to prove nobody ever gets a
seat that doesn't exist.
