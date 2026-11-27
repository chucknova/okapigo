# OkapiGo: a 15-minute demo

A walkthrough of the main journeys with the demo business, **Ìrìn Lagos Tours**: a guest books,
the office runs the day, a guide checks guests in with no signal. Each part has what to click
and one line to say. Every name, phone and email you type should be made up.

| Part | What                                    | Time  |
| ---- | --------------------------------------- | ----- |
| 0    | Before you start                        | 2 min |
| 1    | A guest books on the website and pays   | 3 min |
| 2    | The trip page and the AI companion      | 2 min |
| 3    | A guest books on WhatsApp               | 2 min |
| 4    | The office: Today, the inbox, the desk  | 3 min |
| 5    | A guide checks guests in with no signal | 2 min |
| 6    | A travel site books over OCTO           | 1 min |
| 7    | Posters and the dashboard               | 1 min |

## 0. Before you start (2 min)

```bash
pnpm services:up
pnpm db:reset     # a fresh demo business; wipes your local data
pnpm dev
```

- **Run the reset in the morning.** It places "today" at the time you run it, so a late
  reset misses today's earlier departures.
- **Open these tabs:**
  - the website, <http://localhost:5173/irin-lagos-tours>
  - the staff app, <http://localhost:5175/app/>
  - the WhatsApp simulator, <http://localhost:5174/simulator/whatsapp/>
  - Sojourna, <http://localhost:4400>
- **Sign in to the staff app** as `adaeze@irin-lagos-tours.example`, the owner. The code is in
  the `pnpm dev` terminal: look for `🔑`. Choose **Not now** for notifications, then **Go to
  Today**.
- Payments use the built-in simulator, so no money moves.

## 1. A guest books on the website (3 min)

> "This is the operator's own website. It's run by OkapiGo, and every booking lands in one
> place."

1. On the website, point out the hero photo, the tour cards and the credits in the footer.
   Open **Lagos Island Heritage Walk**.
2. Swipe through the photos; each one's credit changes with it. Choose **Book**.
3. **Choose a date** (step 1 of 4). The seats left are live.
4. **Who's coming:** 1 adult and 1 child. The price updates, and VAT is included.
   > "Seats are held while the guest fills in the form. Two people can't buy the last seat."
5. **Details:** a made-up name and an email ending `.example`. Tick **I'm travelling too**,
   then give each traveller a name and an age. Accept the terms.
6. **Review and pay** (step 4), then **Pay**. The simulator stands in for Paystack's page:
   choose **Pay** again on it.
7. **Booking confirmed**, then **Open your trip page**.

## 2. The trip page and the AI companion (2 min)

> "Everything a guest needs is on one page: no app and no account, and it works on a slow
> phone."

1. Show the QR ticket and the reference ("show this to your guide"), and the meeting point on
   the map.
2. Show **Change or cancel**. The refund the policy gives is worked out before the guest
   confirms. Don't confirm.
3. **Ask a question:** tap the suggestion **What should I wear?** The answer is marked "From
   Ìrìn's notes".
4. Type something the notes don't cover, for example _Can I fly my drone over Freedom Park?_
   It shows **Passed to Ìrìn's team**.
   > "It doesn't make things up. When it isn't sure, a person answers."

## 3. A guest books on WhatsApp (2 min)

> "Many guests in Nigeria would rather book on WhatsApp than on a website. This simulator uses
> the same booking engine as the real WhatsApp."

1. In the simulator, pick a guest under **Chatting as**, then send **Hi**.
2. **See tours**, choose **Lagos Street Food Crawl**, then a date.
3. Answer the bot: how many adults, any children, any extras, a name, and an email (or
   **Skip**). It sums up the booking, with VAT included, and holds the seats for 30 minutes.
4. Tap **Pay** for a **payment link**, open it, and pay with the simulator. Back in the chat,
   a few seconds later: **✓ Booking confirmed**, with the ticket.

## 4. The office (3 min)

> "This is the office's screen. **Today** shows only what needs a person."

1. **Today**, under **Needs you**:
   - a departure with **no guide**: **Assign** a free guide
   - a **refund that failed**: the bank declined it, so it can go again by transfer
   - **cash** a guide collected that hasn't been handed in yet
2. **Inbox › Requests:** the drone question from part 2. Reply to it, and the reply appears on
   that guest's trip page. (A demo business never sends real email: its emails are kept, not
   sent.)
   > "Answer it once with **Add to the FAQs**, and the companion knows it next time."
3. **Bookings:** choose **Upcoming** (the list starts on today's), then search for the guest
   from part 1. Their page shows the timeline, the money,
   and actions such as a payment link, changing travellers, moving the date, or cancelling and
   refunding.
4. **Schedule:** the week, with seats filled, guides and vans. Departures without a guide are
   in red.

## 5. A guide checks guests in with no signal (2 min)

> "Guides work at a beach or on a boat, where there's often no signal. The day's list is saved
> on their phone."

1. In a second browser profile (or a private window), sign in to the staff app as a guide with
   a departure today. In the morning's reset, that's **Halima** (`halima@…`) on the Heritage
   Walk at 09:00. Use a phone-sized window.
2. Open the departure's **manifest**.
3. **Go offline:** in Chrome, open DevTools › Network › **Offline**. The top line changes to
   **Offline · saved**.
4. Check guests in by tapping their names. Record a cash payment with **They paid me cash**.
   **Sync** shows the changes waiting.
5. **Go back online.** The changes send by themselves, and the office's Today shows the
   check-ins and the cash to confirm.

- **In `pnpm dev` the app isn't saved for offline**, so don't reload while offline. To show
  that too, run `pnpm build` and use the built app the API serves at
  <http://localhost:4000/app/>.

## 6. A travel site books over OCTO (1 min)

> "Travel sites connect through OCTO, the open standard for tour bookings. Sojourna is our
> mock of one."

1. On **Sojourna**, open the Heritage Walk, pick a date, then **Continue**. Seats are held
   while the guest pays. Pay (it's a test).
2. In the staff app's **Bookings**, the new booking is tagged **via Sojourna**, **Paid by
   Sojourna**, with what Sojourna owes the business.
   > "One set of seats for every channel, so nothing is ever sold twice."

## 7. Posters and the dashboard (1 min)

1. **Posters:** pick a tour and the **Offer** template, then type a headline. The tour's cover
   photo, the real price and a QR code to book are filled in. **Download PNG**.
2. **Dashboard:** today's numbers, the last 30 days against the 30 before, bookings by channel
   and seats filled by tour. Everything is read from the ledger.
   > "The numbers match the money, because they come from the same double-entry ledger."

## If something goes wrong

- **No sign-in code:** it's in the `pnpm dev` terminal, not in an email. Codes can be asked for
  once every 30 seconds.
- **Today is empty or Needs you is short:** the reset ran late in the day. Run
  `pnpm db:reset` again tomorrow morning, or show the **Schedule** instead.
- **Sojourna has no tours:** run `pnpm db:reset`. It creates the Sojourna channel and its key.
- **The companion answers oddly:** it runs on a fake unless `AI_PROVIDER=anthropic` and a key
  are set in `.env`.
