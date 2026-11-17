# Flow 05: Trip hub (light)

**PRD:** GST-04: _"One low-data page per booking with itinerary, meeting point on a map, what to
bring, the QR ticket and the AI companion."_ Journey 7 (the AI companion, GST-16) is built in
session 17; leave a place for it now.

**Who opens it:** the guest, from the confirmation page and every message we send them. One private
link per booking (like a payment link, the secret is in the URL). No login: guests don't have
accounts in the MVP.

**The most important constraint:** it's opened **on the day, outdoors, on a weak connection**. It must
load fast and stay useful with a poor signal. Keep it light: few images, text first.

---

## The page, top to bottom (suggested)

1. **Status banner** that changes with time (see states)
2. **Tour, date and start time**, and a **countdown** ("Tomorrow at 09:00" / "In 3 days")
3. **QR ticket:** one code for the booking (the guide scans it at check-in, OPS-08), with the
   **reference** printed under it (the guide can search by reference or name if the camera fails),
   and the number of travellers ("3 travellers")
4. **Meeting point:** name and address, a **small map** (OpenStreetMap), **Open in Google Maps /
   Apple Maps**, and a note ("by the fountain"). For pickup tours: the pickup point and time.
5. **What to bring** (a checklist)
6. **Itinerary:** the stops, in order
7. **Travellers:** names (and dietary needs, so guests can check them)
8. **Payment:** paid in full ✓, or the **balance due** with **Pay balance**
9. **Contact the operator:** WhatsApp and call buttons
10. **Ask a question:** the AI companion (session 17). Leave a placeholder for a chat box ("Ask about
    what to wear, where to meet…").
11. **Cancellation:** the policy, plus **Cancel booking** showing **what they'd get back now**
    ("If you cancel now you'll get ₦25,000 back")

## States (please design each)

| When                                    | Banner / changes                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Booked, trip upcoming                   | "See you on Sat 5 Dec!"                                                                        |
| **Balance due** (deposit paid)          | "Balance of ₦45,500 due by Sat 28 Nov" + Pay                                                   |
| **Trip day**                            | QR ticket moves to the top; meeting point prominent; "Starts at 09:00 · Meet at Tinubu Square" |
| After the trip                          | "Thanks for coming!" (reviews are v3)                                                          |
| **Cancelled by the guest**              | "Cancelled · ₦25,000 refund on its way"                                                        |
| **Cancelled by the operator** (weather) | "Ìrìn had to cancel this trip because of the weather. Full refund of ₦X on its way." + contact |
| **Refunded**                            | "Refunded ₦X on {date}"                                                                        |
| Offline / slow                          | the page should still show what it last loaded                                                 |

## Guest cancellation (journey 4)

From the trip hub: **Cancel booking** → a confirmation step that shows **the refund they'll get, from
the policy**, before they confirm ("You'll get ₦12,500 back (50%), because the trip is in 30 hours")
→ **Cancel** → "Cancelled. Your ₦12,500 refund is on its way."

**❓ For you:** should guests be able to cancel themselves, or only ask the operator? (The system
supports both; the PRD journey shows the guest cancelling.)

## Data

Everything shown exists today (booking, travellers, tour content, meeting point coordinates, policy,
refund preview). The trip hub needs a **public, read-only endpoint per booking link**, which I'll add
in session 12.
