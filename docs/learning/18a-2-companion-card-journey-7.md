# Stage 18a-2: the companion on the trip page, its question in the inbox, journey 7

| Part      | What                                                                       |
| --------- | -------------------------------------------------------------------------- |
| 18a-1     | The companion's server: the model behind one interface, its rules, limits  |
| **18a-2** | **The trip page's card (C1–C2), the inbox's question (C3), and journey 7** |
| 18b       | Posters                                                                    |
| 18c       | The dashboard, journey 8                                                   |

Built from the designs on the session 18 canvas, which you approved ("Yes, build 18a-2").

## 1. The card on the trip page (C1–C2)

`apps/web/src/screens/trip/AskCard.jsx` replaces "Ask a question · Coming soon". As everywhere,
the logic is not in the component: **which state** and **every word** come from
`apps/web/src/lib/ask.js`, and the card only draws them.

| State       | When                                                      | What the guest sees                                                     |
| ----------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| **open**    | there's a trip (before, on the day, after)                | C1: the tour's FAQs to tap, the field; then the conversation            |
| **limit**   | 20 questions today (the server says so, or a 429)         | "That's all the questions for today", a WhatsApp (or Call) button       |
| **paused**  | the spend cap, or the AI service down (503)               | "The assistant isn't available right now", the field greyed             |
| **offline** | the page opened with no signal, or a question couldn't go | the saved answers, "No signal"; a failed question keeps its words       |
| **closed**  | cancelled or no-show                                      | one short card: "This booking is cancelled, so the assistant is closed" |

**The conversation** (`askItems`): the guest's words on the right; answers on the left with
where they came from ("From Ìrìn's notes: 'What should I wear?'"); "Looking in Ìrìn's notes…"
while it answers; "Passed to Ìrìn's team" for a question it wasn't sure of; and, once the team
replies, "Reply from Ìrìn · Adaeze · Mon 23 Nov, 09:24" with their words.

- **"4 questions left today"** appears only from 5 left down, so it doesn't nag.
- **The suggestions** go once there's a conversation.

**Saved on this phone** (`savedAsk` / `saveAsk`), like the rest of the trip page: on the day,
outdoors, with no signal, the earlier answers still show. The copy is cleared with the trip's
own copy, two weeks after the trip.

**One stock of questions, shown once.** The card starts from the saved copy, then the server's.
A question asked before the server's answer arrives would otherwise show twice (the server's
list already has it), so each question is shown once by its id. A mutation check found this
was untested; it now has a test.

**Two server changes:**

1. **The reply travels with the question.** A handed-over question carries the team's reply and
   the replier's first name (`reply: { text, at, by }`).
2. **The trip page's request banner no longer repeats these questions.** "Your request was
   sent" and the reply banner skip kind _question_, because the card shows them. Other
   requests (change the date, cancel, something else) still use the banner.

## 2. The question in the inbox (C3)

`assistantNote()` in `apps/operator/src/lib/inbox.js`: for a request of kind _question_, an
info box says "The assistant wasn't sure: nothing in the Heritage Walk's notes covers this, so
it told Tolu the team would reply. It said nothing else."

- **No booking buttons:** "Move to another date…" and "Cancel with a refund…" don't show,
  because it's a question, not a change.
- **"Add to the FAQs"** opens that tour's settings, where the FAQs are, so the assistant can
  answer it next time. The inbox's rows now carry the tour's id for this.

## 3. Journey 7, end to end

`apps/web/e2e/journey-7-companion.spec.js` (the fake model; the run never calls Claude):

1. A Heritage Walk booked and paid; the trip page.
2. "Ask a question": tap **What should I wear?**. The answer is from Ìrìn's FAQ, and says so.
3. "Can I fly my drone over Freedom Park?" → **Passed to Ìrìn's team**; an inbox request of
   kind _question_.
4. The **owner** signs in, opens the request: "The assistant wasn't sure", "Add to the FAQs";
   replies and marks it answered.
5. The guest's trip page shows the reply under their question.

**What the full run found** (journey 7 passed alone, failed twice in the full run):

- **One sign-in code per address per minute.** Journey 3 signs the manager in earlier in the
  run, so journey 7's code for the same manager was refused ("Too many codes asked for").
  Journey 7 now signs the owner in, which also fits the PRD's "owner".
- **A note that doesn't stay.** "Sent, and marked answered." can vanish as the card becomes a
  done request; the journey now checks the line that stays (" · replied by …").
- **Run alone, the staff app must be rebuilt first.** `pnpm e2e` builds it; `playwright test`
  on its own uses whatever `apps/operator/dist` holds. A stale build showed the request
  without the new box.

## 4. Checks

- `apps/web/test/ask.test.jsx` (29):
  - the states and their order
  - the field in each state
  - the words for every box, and "questions left"
  - the conversation (source or not, the reply with or without a name)
  - what each refusal means
  - the saved copy (blocked storage, cleared with old trips)
  - the card: tap a suggestion, thinking, the reply, 429, 503 (with a Call link), already
    paused, no signal, a failed send keeping its words, another refusal's words, cancelled,
    and asked-before-the-load shown once
- `apps/web/test/trip-hub.test.jsx`: after the trip the card is there (it was "not yet").
- `apps/operator/test/inbox.test.jsx` (+2): the question card; other kinds unchanged.
- `apps/api/test/companion.test.js` (+1, and the hand-over test): the reply in the card, not in
  the banner; other kinds still in the banner.
- **Mutation checks:** 29 changes. 2 survived at first:
  - the "show once" rule now has a test
  - a "reply with no reply time" guard was simplified away (the server always sets both)
- **Full runs:**
  - Run 1 failed one test that this stage doesn't touch: `settings-staff.test.js` "removing
    a guide". It failed alone too, so it was real.
  - **It was a calendar trap.** On Mon 23 Nov the "next two departures" were Wednesday's
    Lekki half-day (08:00, 5 h) and Heritage Walk (09:00). They overlap, and the database
    rightly refuses one guide on both. The test now picks two Heritage Walks (one a day).
  - Run 2 passed: 1,724 tests.
- **E2E:** all 11 journeys pass, with journey 7, after the two fixes above.
- **Browser check** (my API on :4300, the e2e database, a throwaway business):
  - C1 as designed (dark mode): the FAQs to tap, Send greyed until there's text
  - "What should I wear?" was answered with its source
  - the drone question was passed to the team, and the field said "Ask another question"
  - the business was deleted afterwards

## 5. Concepts to study

- **Optimistic and saved state together**: showing a saved copy, a server copy and what was just
  done, without duplicates (by id).
- **Rate limits across tests**: shared state (one person's sign-in codes) between e2e journeys.
- **Date-dependent tests**: "the next two departures" means different tours on different days.
