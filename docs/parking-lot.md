# Parking lot

Ideas that come up while building but are **not** in the MVP's 37 requirements. They go here
instead of into the code, so the MVP actually ships. Review this list when planning v1.

| Date       | Idea                                                                                        | Why it came up                                                                                     | Likely version                  |
| ---------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| 2026-11-16 | Per-IP rate limiting on public routes (e.g. `express-rate-limit` backed by Redis)           | Session 3 limits codes per email/phone, but one IP could still try many different addresses        | Before public demo (session 18) |
| 2026-11-16 | CORS configuration for the PWA and guest web origins                                        | Not needed until a browser app calls the API                                                       | Session 10 / 14 (when needed)   |
| 2026-11-16 | Monthly schedule rules ("first Sunday of the month")                                        | `daysOfWeek` covers daily and weekly only                                                          | v1 if an operator needs it      |
| 2026-11-16 | Promo code management (create codes, validity dates, usage limits)                          | The pricing pipeline supports a promo step (INV-24) but no MVP requirement covers managing codes   | v1 / v3 Marketing               |
| 2026-11-16 | Credit / voucher instead of a cash refund on cancellation                                   | BKG-26 mentions "refund amount, credit or forfeited deposit"; credits need a voucher system        | v1                              |
| 2026-11-17 | Accrual accounting: hold payments as deferred revenue until the tour runs                   | The MVP recognises revenue at payment (simple, honest); proper accrual is better for an accountant | v1                              |
| 2026-11-17 | Paystack webhook IP allowlist (extra to signatures)                                         | Signatures already prove origin; allowlists are fiddly behind proxies                              | Before going live (post-MVP)    |
| 2026-11-17 | Reconciliation job: re-verify payments stuck in "initiated" for over an hour                | Catches a webhook Paystack never delivered                                                         | Stage 10e (reconciliation)      |
| 2026-11-17 | Retention policy for webhook_events (archive after N months)                                | The table grows forever; fine at demo scale                                                        | v1                              |
| 2026-11-17 | Settlement reconciliation: match Paystack payouts to the bank and the clearing account      | Payouts are a v1 feature (POS, payouts)                                                            | v1                              |
| 2026-11-17 | Booking cutoff per tour ("stop selling N hours before departure")                           | Public checkout (11a) sells right up to the start time                                             | v1, or MVP if Ìrìn needs it     |
| 2026-11-17 | Set Express `trust proxy` for the real deployment (so `req.ip` is the guest, not the proxy) | Rate limits (11b) count per IP; behind a load balancer every guest would share the proxy's IP      | Session 18 (deploy)             |
