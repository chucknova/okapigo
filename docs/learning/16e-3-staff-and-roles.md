# Stage 16e-3: Settings: Staff and roles

Settings (O10), part three of four:

| Part      | What                                                                                      |
| --------- | ----------------------------------------------------------------------------------------- |
| 16e-1     | the settings menu, the save bar and form errors, Website, Embed on your site              |
| 16e-2     | Messages (the editor, details to insert, preview, a test) and WhatsApp                    |
| **16e-3** | **Staff and roles (invite, edit, remove); invitations emailed, words to copy for phones** |
| 16e-4     | Tours (basics, prices, schedule, extras, pickups, policy, deposit, transport, new tour)   |

## 1. What we built

| Piece                                                                                     | Where                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| The rules: who sees which section, the roles' lines, the form's checks, removing in words | `apps/operator/src/lib/settings.js` (Staff)   |
| The screen: the team, invite, edit, remove                                                | `apps/operator/src/screens/SettingsStaff.jsx` |
| The team in words; invite, resend; edit; remove                                           | `apps/api/src/routes/staff.js`                |
| The invitation: words to copy, and the email                                              | `apps/api/src/messages/invite.js`             |
| Editing a name or contact (the shared rule)                                               | `packages/shared/src/schemas/roles.js`        |

The app now gets the **mailer** (Mailpit in development) that guest emails use, so the
staff route can email an invitation the moment someone is added.

## 2. The team, in words

Each person: how they sign in ("dayo@example.com", "0809 777 8899"), their role, and how they
stand. None of it needed new columns:

| Status  | From                                   | Words                                   |
| ------- | -------------------------------------- | --------------------------------------- |
| invited | no sign-in session yet                 | Invited · hasn't signed in (and Resend) |
| active  | has signed in; their phone's last sync | Active · synced 07:31                   |
| removed | `isActive` is false                    | No access (and Give access back)        |

**Managers and guides don't see Staff at all** (the design). The menu now lists only the
sections a role may at least look at (`visibleSections()`): a manager sees Website, Embed,
WhatsApp and Tours; a guide sees Tours.

## 3. Inviting someone

Name, email or phone, role (Guide first; what each role may do underneath). The design had no
name field; it's needed for the list and for the invitation's "Hi Dayo".

- **An email address**: OkapiGo emails the invitation ("Join Ìrìn Lagos Tours on OkapiGo",
  with an Open OkapiGo button), from the business's name, replies going to whoever invited.
- **A phone**: the owner gets **the words to copy** and send by WhatsApp or SMS ("Hi Segun,
  Bisola has added you to Ìrìn Lagos Tours on OkapiGo as a guide. Open … and sign in with 0806
  111 2233. We'll send you a code."). Copy puts them on the clipboard.
- **No email on this server, or the email fails**: the person is added anyway, and the owner
  gets the words to copy, with why.

There's **no secret link**: the invited person opens the app and signs in with the email or
phone they were added with, by a one-time code, like everyone else. An invitation can't be
stolen and used by someone else.

**Resend** sends the same invitation again (only for someone who still has access).

## 4. Editing someone

Name, email or phone, role. Only what changed is sent.

- **Making someone an owner asks first**: "Owners can change prices, staff and payouts."
- **There must always be at least one owner.** The server refuses making the last active owner
  something else, or removing them ("There must always be at least one owner."). A removed
  owner doesn't count.
- **Not your own role or access** (you could lock yourself out). Your own name and contact are
  fine.
- **The contact shown is the one replaced**: change an email to a phone and the email goes (it
  was how they signed in). A second contact they have, not shown, stays.

## 5. Removing someone

"Remove Tolu's access?":

- **Tolu is signed out at once, on every phone.** Their sessions are revoked; their phone's next
  request is refused.
- **What their phone had waiting**, from its last sync: "3 changes waiting on their phone at its
  last sync (07:31). Those don't arrive once Tolu is removed: ask Tolu to open OkapiGo with
  signal first, or someone redoes them on the departure."
- **The departures that will have no guide**: "2 upcoming departures will have no guide:
  Heritage Walk · Sat 5 Dec, 09:00 (today) · Street Food · Fri 11 Dec, 18:30".
- **Remove and show me those departures** · **Keep Tolu**.

Then: they come off those departures (past ones keep their record), any chat they'd taken over
goes back to **Needs a person**, and the screen lists the departures with links, to assign
someone else. **Give access back** undoes the removal (they sign in again).

### Why removal is instant (decided 2026-11-21)

The design said changes on their phone "still arrive and are kept as theirs". They can't, safely:
a removed person's phone is signed out, and letting it keep sending changes for a while would
let someone who's left write check-ins, no-shows or cash reports for a day, with a phone clock
that can't prove when a change was made. So the screen **says it accurately**: what was waiting,
and that asking them to sync first is a good idea, not a requirement. Most of the time it's
nothing.

## 6. Tests

- `apps/api/test/settings-staff.test.js` (9): the team in words (synced, waiting, coming
  departures, invited, no access); invited by email (escaped, from the business, reply to the
  inviter; resent), by phone (words, "an operations manager"), no email or a failing one;
  someone already on OkapiGo; editing (the contact replaced, someone else's refused); your own
  name but not role; at least one owner; removing (signed out, off coming departures only,
  chats back to a person, twice changes nothing, access back).
- `apps/operator/test/settings-staff.test.jsx` (13): the rules; the team; a manager doesn't see
  Staff; invite (checked, the words to copy, emailed, resend, refused); edit (only what
  changed, the owner question, the server's refusal, yourself); remove (what was waiting, the
  departures, Keep, then the departures to reassign); give access back.
- Mutation checks: 33 changes; 5 survived at first. Four got tests (a cancelled departure isn't
  "upcoming", "(today)", nothing waiting, the owner rule never holds back a non-owner) and one
  line was simplified (removing someone already removed).
- Browser check (as Tunde, then the seed owner on the check server; nothing saved or sent):
  Tunde's menu has no Messages or Staff, and the address says "This page is for the owner". The
  owner's list showed invited and synced people correctly; four columns were too cramped, so
  each row is now name and contact, with role and status beneath, and on a phone the buttons
  drop under the name.
