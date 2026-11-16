# Session 3: Sign-in with one-time codes, roles and permissions

**PRD coverage:** **ACC-01** (sign-up by phone or email with a one-time code, no card) and
**ACC-05** (preset + custom roles with view/edit per module, enforced on every API route).
Completes build step 1.

**Done when:** a staff user signs in, and Supertest tests prove permissions are enforced. ✅
49 API tests, including a guide being refused the staff list and an owner being unable to touch
another operator's data.

---

## 1. What we built

```
apps/api/src/
├── auth/
│   ├── otp-service.js      request + verify one-time codes (the security-critical part)
│   ├── session-service.js  create / look up / revoke sessions
│   └── otp-sender.js       delivers codes (log only, for now)
├── middleware/
│   ├── auth.js             requireAuth (401) + requirePermission(module, level) (403)
│   └── validate.js         Zod-validates body/params before a handler runs (400)
├── lib/secrets.js          random codes/tokens, hashing, constant-time compare
└── routes/
    ├── auth.js             /auth/signup, /auth/signup/verify, /auth/otp/*, /auth/logout
    ├── me.js               GET /api/me
    ├── roles.js            GET/POST/PATCH/DELETE /api/roles
    ├── staff.js            GET/POST/PATCH /api/staff
    └── serializers.js      the exact fields each response may contain

packages/shared/src/
├── contact.js              "0803 123 4567" → "+2348031234567"; emails lowercased
├── slug.js                 "Ìrìn Lagos Tours" → "irin-lagos-tours"
└── schemas/auth.js, roles.js   Zod schemas (reusable by the future sign-in screens)

packages/db: new tables otp_challenges and sessions; createOperatorWithPresetRoles()
```

### The endpoints

| Method + path                  | Who            | What                                                      |
| ------------------------------ | -------------- | --------------------------------------------------------- |
| `POST /auth/signup`            | anyone         | Start creating a business; sends a code                   |
| `POST /auth/signup/verify`     | anyone         | Code correct → business, roles, owner and session created |
| `POST /auth/otp/request`       | anyone         | Send a sign-in code (if the account exists)               |
| `POST /auth/otp/verify`        | anyone         | Code correct → session token                              |
| `POST /auth/logout`            | signed in      | Revoke this session                                       |
| `GET /api/me`                  | signed in      | Who am I, which business, what may I do                   |
| `GET /api/roles`               | settings: view | List roles                                                |
| `POST/PATCH/DELETE /api/roles` | settings: edit | Manage custom roles                                       |
| `GET /api/staff`               | settings: view | List staff                                                |
| `POST/PATCH /api/staff`        | settings: edit | Add staff, change role, deactivate                        |

## 2. How it works

### Signing in

```
PWA                         API                                   Database
 │ POST /auth/otp/request     │                                       │
 │  { contact: "0803…" }      │ normalise → +234803…                  │
 │ ─────────────────────────► │ rate limit ok? account exists? ─────► │
 │                            │ code = 042917                         │
 │                            │ store HMAC(secret, code) ───────────► │ otp_challenges
 │                            │ otpSender.send(code)  (log for now)   │
 │ ◄──── 202 "if it exists…"  │                                       │
 │                            │                                       │
 │ POST /auth/otp/verify      │                                       │
 │  { contact, code }         │ claim 1 attempt (atomic UPDATE) ────► │
 │ ─────────────────────────► │ compare hashes (constant time)        │
 │                            │ mark consumed ──────────────────────► │
 │                            │ token = 256 random bits               │
 │                            │ store sha256(token) ────────────────► │ sessions
 │ ◄── 200 { token, user }    │                                       │
 │                            │                                       │
 │ GET /api/me                │                                       │
 │ Authorization: Bearer tok  │ sha256(tok) → session → user → role ─►│
 │ ─────────────────────────► │ requirePermission(...)                │
```

### The atomic-claim trick (read `verifyCode` in `otp-service.js`)

A 6-digit code is only safe because you get **5 guesses**. The obvious code is:

```js
if (challenge.attempts >= 5) reject(); // 1. read
await increment(challenge.attempts); // 2. write
```

Between 1 and 2 there's a gap. Send 30 guesses _at once_ and they can all read `attempts = 0`
before any increment lands. **We tested this: the naive version allowed 28 guesses.** Our version
makes the database do the check and the increment in **one statement**:

```sql
UPDATE otp_challenges SET attempts = attempts + 1
WHERE id = $1 AND attempts < 5 AND consumed_at IS NULL AND expires_at > now()
```

The database applies these one at a time, so only 5 can ever succeed. A request whose claim
failed never gets to compare the code. This is a **race condition**, and the same idea (let the
database be the referee) is how we'll stop double-selling seats in session 6.

### Default deny

In `app.js`, `api.use(authenticate)` runs before **every** route under `/api`. A new route
added later is protected automatically; forgetting `requirePermission` still only exposes it to
signed-in staff of the same business. The test `GET /api/anything-new needs sign-in` proves it.

### Tenant scoping

Every query in the staff API includes `operatorId: req.auth.operatorId`. Asking for another
business's staff or role by ID returns **404, not 403**: we don't even confirm it exists.

## 3. Why we chose what we chose

| Choice                                      | Why                                                                                            | Trade-off                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Database sessions, not JWTs**             | Revocable instantly: sign-out, or deactivating a guide, works on their next request.           | One DB lookup per request (cheap at our scale).                                            |
| **30-day sessions**                         | Guides on tour can't afford a session that expires mid-tour with no signal (PRD: 72h offline). | A stolen phone stays signed in until someone deactivates the user, which is now one click. |
| **Bearer token, not cookies**               | The API, guest web and PWA live on different domains; cross-site cookies are painful.          | The client must store the token carefully (we'll handle it in the PWA session).            |
| **HMAC for codes, SHA-256 for tokens**      | Codes have only 1M values, so they need a secret mixed in. Tokens are already 256 random bits. | One more secret to manage (`AUTH_SECRET`).                                                 |
| **Same reply for unknown accounts**         | Stops "account enumeration" (probing which emails are staff).                                  | Slightly less helpful message on typos.                                                    |
| **Sign-up _does_ say "already registered"** | Telling a real owner to sign in instead is worth more than hiding it.                          | Conscious, documented trade-off.                                                           |
| **Sign-up data waits in the challenge**     | Abandoned sign-ups create no half-made businesses.                                             | Payload stored as JSON for 10 minutes.                                                     |
| **Can't change your own role**              | Stops the only owner locking themselves out.                                                   | Owners need another owner to demote them (fine).                                           |
| **Services + thin routes**                  | Business logic (`otp-service.js`) is separate from HTTP plumbing (`routes/auth.js`).           | Slightly more files.                                                                       |

## 4. Concepts to study

- **Authentication vs authorisation**: who you are (401) vs what you may do (403).
- **One-time passwords**, rate limiting, brute-force maths (5 tries / 1,000,000 = 0.0005%).
- **Hashing vs HMAC vs encryption**: when each is the right tool.
- **Timing attacks** and constant-time comparison.
- **Race conditions** and **atomic updates** (`UPDATE … WHERE …` as a check-and-set).
- **Sessions vs JWTs**: the revocation trade-off.
- **Account enumeration.**
- **Default deny** and **least privilege**.
- **Serializers / DTOs**: whitelisting response fields.

## 5. Try it yourself

```bash
pnpm dev   # leave running; codes appear here
```

In another terminal (the README has these too):

```bash
curl -X POST localhost:4000/auth/otp/request -H 'content-type: application/json' -d '{"contact":"0803 000 0003"}'
# copy Kemi's code from the API log
curl -X POST localhost:4000/auth/otp/verify -H 'content-type: application/json' -d '{"contact":"08030000003","code":"<code>"}'
curl localhost:4000/api/me    -H 'Authorization: Bearer <token>'   # works
curl localhost:4000/api/staff -H 'Authorization: Bearer <token>'   # 403: Kemi is a guide
```

Experiments:

1. Request a code twice within 30 seconds → 429.
2. Enter a wrong code 5 times, then the right one → still rejected.
3. Sign in as Adaeze (owner), create a custom role with `POST /api/roles` (look at
   `test/permissions.test.js` for the body), move Kemi into it, and watch Kemi's `/api/me`
   permissions change without her signing in again.
4. Look at the raw tables: `docker compose exec postgres psql -U okapigo -c "select destination, code_hash, attempts, consumed_at from otp_challenges order by created_at desc limit 3"`.
   No codes, only hashes.
5. **Break it on purpose:** in `otp-service.js`, replace Step 1 with the naive read-then-check
   version (it's in this note) and run `pnpm --filter @okapigo/api test`. Watch the parallel test
   fail with "expected 28 to be 5". Then undo with `git checkout apps/api/src/auth/otp-service.js`.

## 6. Gotchas

- **Your `.env` needs `AUTH_SECRET`.** I added a random one to your local `.env`; `.env.example`
  has a placeholder. The API refuses to start without one at least 32 characters long.
- **The log OTP sender refuses to run with `NODE_ENV=production`.** Printing working codes into
  production logs would let log readers sign in as anyone.
- **Prisma 7 `migrate reset` doesn't seed** (found this session, fixed in `db:reset`; see the
  correction in note 02).
- **A test that passes first time deserves suspicion.** I deliberately broke the code to prove
  the race test actually catches the bug. Do this for any test guarding something important.
- **Parked for later** (`docs/parking-lot.md`): per-IP rate limiting before the public demo,
  and CORS when the first browser app calls the API.

## 7. What's next: session 4

**Products, prices and schedules (INV-01, INV-03, INV-05, INV-10).** The tour catalogue:
products with stops, meeting points, inclusions; adult/child/infant price categories with age
rules; add-ons with stock; and schedules that generate departures (daily, weekly, custom, with
exceptions). The seed grows to Ìrìn's five real tours, and the first `products` permission checks
go live.
