# CLAUDE.md — Baby Shower Invitation & Registry

Single-event baby shower website (invitation, RSVP, gift registry, host dashboard). React + Vite SPA on Cloudflare Pages,
with Pages Functions + KV (data) + R2 (media) and Resend (email).
Built from a Claude Design prototype (the prototype itself isn't committed; `.reference/PORTING.md` keeps the porting
rules and the store contract). English UI; **source comments in Chinese**.

**The whole site is behind a guest sign-in.** Everyone on the site was invited by a host, so there is exactly
one identity system: you sign in with the email you were invited at, a 6-digit code proves the mailbox is
yours, and you get a 7-day sliding session cookie. A **host is simply a guest whose email is in `HOST_EMAILS`**
— there is no Cloudflare Access any more.

## Commands
```bash
npm install
cp wrangler.example.toml wrangler.toml   # gitignored: KV id, HOST_EMAILS, RESEND_FROM, PUBLIC_BASE_URL
cp .dev.vars.example .dev.vars           # gitignored: TOKEN_SECRET, EMAIL_MODE=console, HOST_EMAILS=host@example.com
npm run cf          # build + wrangler pages dev on http://localhost:8788 (Functions + local KV/R2)
npm run cf:only     # wrangler pages dev without rebuilding (serves current dist/)
npm run dev         # Vite dev + HMR on :5173, proxies /api → :8788 (run cf:only alongside)
npm run build       # vite build → dist/
npm run deploy      # build + wrangler pages deploy dist --project-name babyshower
npm test            # vitest run: tests/**/*.test.js — unit + API handlers on in-memory KV/R2, ~2 s, no network
scripts/smoke.sh    # the "Verify a change" curl flow against a running `npm run cf` (BASE / HOST_EMAIL to override)
```
Local dev email: `.dev.vars` sets `EMAIL_MODE=console` — emails print to the wrangler terminal, and the
sign-in code is also returned as `devCode` from `/api/auth/start` (never in prod, where `EMAIL_MODE=resend`).
There is no auth bypass: **sign in for real, locally too.** Hosts come from `HOST_EMAILS` and `getGuests()`
always puts them on the roster, so a fresh KV is never locked out.

## Architecture

**Frontend** (`src/`)
- `store.jsx` — the single state hub (React context). One `GET /api/me` on mount decides everything: signed
  in → fetch `/api/public` + `/api/registry`; signed out → a teaser-only shell. **This is the stable contract
  every component consumes via `useStore()`** (enumerated in `.reference/PORTING.md`) — change the data
  source here, not in components. Async saves read `dataRef.current` (not the render-closure `data`).
- `useAuth.js` — the sign-in state machine (email/invite-token → code → cookie). `store.jsx` spreads it into
  the same `useStore()` value, so components never learn a second hook.
- `api.js` — fetch client. Identity rides on the HttpOnly cookie; `fetch` already defaults to
  `credentials: 'same-origin'`, so **don't add `credentials: 'include'`**. Both `jget` and `jsend` attach
  `.status` to thrown errors — the 401 (session-expired) path depends on it. `errText(e, fallback)` derives
  user-facing copy — it trusts the server `error` only for 4xx, and falls back to generic for 5xx/offline so
  the raw `url → status` debug string never reaches the UI.
- `csv.js` — host CSV export builders (pure, no DOM: every cell quoted, UTF-8 BOM, CRLF, formula-injection
  guard on `= + - @ TAB CR LF`); `util.js` `downloadFile(filename, text, mime)` saves it via Blob + `<a download>`
  (shared with any future file export). `exportCsv(kind)` re-fetches the host-gated `/api/admin/all` on every
  click and builds the file from that response without writing it back — there is no export endpoint.
- `pages/` (Landing, Invitation + `themes/`, Registry, Admin), `admin/` (4 tabs), `components/` (modals,
  Envelope, Toast, GuestNav, `ui.jsx` = Hover/FocusInput = the prototype's `style-hover`/`style-focus`).
- `components/Envelope.jsx` — the envelope animation, shared by the Landing page and the admin email preview.
- Path routing (`/`, `/registry`, `/admin`). `App.jsx` gates them: `/` renders Landing when signed out,
  `RequireGuest` bounces `/registry`, `RequireHost` bounces `/admin` (server-side 403 is the real defence).

**Backend** (`functions/`, Pages Functions, file-based routing)
- `lib/kv.js` — KV access + **seed-as-fallback** (`seed-data.js`, generic demo data only): reads return the seed
  default when a key is absent; the host's first edit persists over it. `readJSON` deep-clones the fallback.
  **`getEvent()` merges `SEED_EVENT` field by field**, so a new event field needs no KV migration — but every seed
  event value shows on a live site until the host saves that field, so seed values must stay generic. **`getGuests()` also
  force-merges every `HOST_EMAILS` address onto the roster on every read** (even when the `guests` key exists),
  so a host is always present and can always sign in — the merge is in-memory, persisted on the next roster write.
  An injected host's id is `host-` + the first 20 letters/digits of the email; if that id is already taken (a stored
  row or an earlier injected one) it gets `-` + 6 hex of `emailHash(em)`, because login, sessions, edits and claimer
  names all look rows up **by id**. Ids that don't collide are unchanged.
- `lib/token.js` — HMAC tokens with a **required** `typ`: `'s'` session (7d), `'i'` invite (90d).
  `verifyToken(env, token, expectType)` — `expectType` is a required positional arg on purpose, so an invite
  token can never be replayed as a session. Fail-closed if `TOKEN_SECRET` is unset. Invite tokens carry
  `{guestId, sv}` too, and both `auth/start` and `auth/verify` refuse one whose `sv` isn't the guest's current
  `sv` (`invalid_invite`), so **an email change also voids every invitation link already sent** (missing = 0).
- `lib/session.js` — the `bs_session` cookie (HttpOnly, SameSite=Lax, `Secure` only over https so
  `http://localhost` works) + `needsRenew`. **Sliding renewal happens only in `GET /api/me`.** The session payload
  is `{guestId, sv}` (`sv` = the guest's session version, missing = 0), and `sessionCookie(request, env, guest)`
  takes the **guest object**, not an id, so no caller can forget `sv` (that would mint tokens that log out at once).
- `lib/guard.js` — `resolveGuest` (cookie → verify → re-resolve from the roster **and require
  `(payload.sv||0) === (guest.sv||0)`**, so deleting a guest or changing their email instantly revokes their
  sessions), `requireGuest` (401), `requireHost` (401 if signed out, else 403 unless
  `guest.email ∈ HOST_EMAILS` — the 401 lets an expired host session log out instead of silently 403ing).
- `lib/resend.js` + `lib/email-templates.js` (verification, invitation, RSVP reminder, host notices). The
  templates are also bundled client-side by `EmailContentPreview`, so they must stay pure — no env, no server imports.
- `lib/calendar.js` — pure and shared with the SPA like email-templates (`store.jsx`, `EventTab`): the
  `startsAt`/`endsAt`/`tz` validators `admin/event.js` uses, Intl-only local→UTC, and the .ics + Google Calendar URL builders.
- Public: `api/me.js` (always 200; carries the landing-page teaser; renewal re-signs the current `sv`),
  `api/auth/{start,verify,signout}.js` (**verify binds a code to the address it was mailed to**: it refuses —
  and deletes — the code unless the guest's *current* email is still that address; load-bearing for revocation),
  `api/media/[key].js`, `api/health.js`.
- Guest-guarded: `api/public.js`, `api/registry.js` (marks `mine`; hides claimer names unless
  `showClaimerNames`, and strips `price` unless `showPrices` — both server-side, not just in the client; it
  also still strips `was`, a **removed** field that lingers on already-stored items because `updateItem`
  merges rather than replaces — that strip is load-bearing, not dead code; it likewise strips the host-only
  `receivedAt`/`thankedAt` as a second guard behind `getRegistryItems`' `withThanks` opt-in),
  `api/claim/[[path]].js` (claim + self-unclaim; the idempotent re-claim echoes only `{guestId, name, at}`, never
  the raw record), `api/rsvp/submit.js`.
- Host-guarded: `api/admin/*` — `all.js`, `event.js`, `design.js`, `config.js`, `guests/[[path]].js` (also
  `PATCH :id` = rename / fix email, `POST send-all` and `POST remind-all`), `items/[[path]].js` (also
  `POST :id/rehost` and `PUT :id/thanks`), `media/[[path]].js`. **All bulk mail goes through the throttled
  `sendBatched(env, list, render, onBatch)`** in the guests router — `SEND_BATCH` = 5 in parallel,
  `SEND_PAUSE_MS` = 1 s between batches, i.e. at most half of Resend's 10 req/s team limit, which sign-in codes share. It returns `Map<id, lc(email mailed)>`; the roster is re-read and
  stamped (`sentAt` / `remindedAt`) only where `sent.get(g.id) === lc(g.email)`. **Bulk sends stamp after every
  batch** (`onBatch` → `stampGuests`, which re-applies the running total so a stale KV read is harmless, retries a
  failed write once and never throws — a lost write comes back as `stampFailed: true`), and the router wraps
  `send-all` / `remind-all` in `context.waitUntil` (`keepAlive`) so a reload or dropped connection mid-send doesn't
  cancel the run and leave mailed guests unstamped (= mailed again on the next click). Reuse the module's one
  `lc` (trim + lowercase) — never declare a second one. `remind-all` picks recipients only server-side (invited,
  no `rsvp:<id>`, not a host, nothing sent in 20 h via `max(sentAt, remindedAt)`) and returns 423 while `rsvpClosed`.

**Tests** (`tests/`, Vitest, config in `vitest.config.js` — kept out of `functions/`, which Pages would route)
- `tests/helpers/env.js` — the runtime doubles: `makeEnv({ kv, ...vars })` (in-memory KV with `failPut(key)` to
  simulate the 429 write limit, in-memory R2, the `.dev.vars` values), `cookieFor(env, guest)` / `hostCookie(env)`
  (real `session.js` cookies), `call(handler, env, {...})` / `catchAll(handler, base)` to invoke a Pages Function
  with `{ request, env, params, waitUntil }`, `captureEmails()` (console-mode recipients) and `shrinkTimers()`
  (batch pauses / retries / the 10 s fetch timeout without waiting). `fetch` is stubbed per test with
  `vi.stubGlobal`; mocks and stubs are restored after every test.
- `tests/lib/` = `functions/lib/*`, `tests/api/` = route handlers, `tests/src/` = pure frontend modules (`csv.js`).
  Test names English, comments Chinese. TZ is pinned to UTC in the config. A server-side rule (gate, strip,
  cascade, 423/429 copy) changed or added → add or update its test in the same change.

**KV keys:** `event` / `design` / `config` / `guests` / `items` (host, single keys; a `guests` row is
`{id, name, email, sentAt, remindedAt?, sv?}`, `remindedAt` written only by `remind-all`, `sv` (session version)
bumped only by an email change in `PATCH admin/guests/:id`) · `rsvp:<guestId>` ·
`claim:<itemId>` = `{guestId, name, at, receivedAt?, thankedAt?}` (the last two are host-only receive/thank
progress in epoch ms, written only by `PUT /api/admin/items/:id/thanks`, merged only into `/api/admin/all` via
`getRegistryItems(env, { withThanks: true })`, deleted with the claim; a guest can't self-unclaim once received → 409;
legacy claims may lack `guestId`) · `code:<emailHash>` (10-min TTL, `:cd` 60s cooldown, `:lock` 15min
after 5 misses — but a fresh code request clears `:lock`) · `send:<YYYY-MM-DD>` (global daily code-send budget,
`DAY_CAP` in `auth/start.js`, 2-day TTL). Media in R2 under random keys (`mediaKey`/`imgKey`).

## Conventions & gotchas
- **UI text English, comments Chinese.** Match the prototype's exact copy/styles; `ui.jsx` replaces the
  design tool's `style-hover`/`style-focus`. See `.reference/PORTING.md` for the dc→JSX rules and the
  `useStore()` field list — **update that list in the same commit as any store change.**
- `HOST_EMAILS` (`wrangler.toml`, gitignored — template in `wrangler.example.toml`) is the only key to the
  dashboard, and the only source of hosts: there are no seed guests. The admin refuses to delete a host from the
  guest list.
- **Deletes cascade** so nothing is stranded: removing a guest drops their `rsvp:<id>` **and** every
  `claim:<itemId>` they hold; removing an item drops its `claim:` key and its R2 image. Keep new per-entity
  keys in these cleanup paths (`admin/guests` `removeGuest`, `admin/items` `removeItem`). The receive/thank
  progress lives on `claim:` **on purpose**, so every existing cascade (and the host Unclaim) already removes it.
- **Editing a guest** (`PATCH /api/admin/guests/:id`, `{name?, email?}`) keeps the id, so their RSVP and claims
  stay. An email change sets `sentAt = null`, deletes `remindedAt` and bumps `sv` (revoking every session). A host's
  email is locked (403 when the current email is in `HOST_EMAILS` **or** the id starts with `host-` — `getGuests`
  would otherwise inject a fresh host row for the old address, splitting the person across two rows); renaming
  anyone is allowed. Email uniqueness (409) is checked against `getGuests()`, which always contains every host address — load-bearing: it stops a guest
  being re-pointed at a host email (whose existing sessions would then be judged host). `sendInvite` returns 409
  (no stamp) if the email changed mid-send. Claimer names are resolved live from the roster in `getRegistryItems`
  (`(c.guestId && nameOf.get(c.guestId)) || c.name`) — `claim.name` is only the fallback for legacy `{name, at}`
  claims and is never rewritten. `EMAIL_RE` lives once per side: `src/util.js` and the guests router.
- The `config` display toggles (`showPrices`, `showClaimerNames`) are host-editable from the **Registry admin
  tab** (`RegistryTab` → `toggleConfig`), and both are enforced **server-side** in `api/registry.js` — the
  client hiding is cosmetic, the server is the real gate.
- The close-mode flags `rsvpClosed` (GuestsTab) and `registryClosed` (RegistryTab) are enforced server-side in
  `api/rsvp/submit.js` and `api/claim/[[path]].js` (claim **and** unclaim, checked right after `requireGuest` and
  before any item/claim read — later checks go after it). Both return **423** with human-readable `error` copy;
  hosts get no exemption on these guest routes. The host overrides (`PUT /api/admin/guests/:id/rsvp`,
  `POST /api/admin/items/:id/unclaim`) bypass them on purpose. A missing flag means open (`=== true`).
- `PUT /api/admin/config` is a **whitelisted per-key merge**: `toggleConfig` sends only the changed key, unknown
  keys are dropped (config is echoed whole to every guest), and any new config key must be added to its `COERCE`
  table.
- `/api/media` is deliberately **not** gated; R2 keys are random and only ever appear inside the gated
  `/api/public` + `/api/registry`.
- **Nothing private may ship in the client bundle — or in the repo.** `src/mock.js` was deleted for exactly this
  reason; when the API is unreachable the store shows `<BootError>` rather than a plausible-but-fake invitation.
  Real names, emails, venue, dates and the real registry live only in KV and the gitignored `wrangler.toml`;
  `seed-data.js`, docs and examples use placeholders (`host@example.com`, "Alex & Sam").
- Registry item images: host uploads go to R2 (`imgKey`), which beats a pasted `imgUrl`; with neither, `ph(cat)`
  draws a placeholder. The host can also copy a pasted `imgUrl` into R2 ("Save image" / "Save external images
  (n)" → `POST /api/admin/items/:id/rehost`). The server fetches the item's **stored** URL (never one from the
  request): https and public hostnames only, ≤3 redirects each re-checked, 10 s timeout, 8 MB cap enforced while
  streaming, ≥1 KB, and the bytes are sniffed as JPEG/PNG/GIF/WebP/AVIF (never SVG/HTML). It stores `imgKey` and
  **clears `imgUrl`** — a non-empty `imgUrl` at save time means "replace the photo", so keeping it would let the
  next ordinary Edit → Save delete the copy. `functions/lib/media.js` (server-only) is the one home of `MAX_IMAGE`
  and the `item-<id>-<12 hex>` key format, shared with the upload route.
- Themes: the default (seed + `EMPTY_DATA`) is **Garden**, which is pure CSS. Wisteria Ink's artwork
  `public/themes/wisteria.webp` is gitignored (licence unclear — bring your own); without it the SPA fallback serves
  HTML for that URL, so the card and the Design-tab thumbnail end their `background` with the paper colour `#FBF7ED`
  and read as plain paper. Keep the theme-selection fallback branch on `WisteriaCard` (it also catches legacy `'classic'`).
- KV is eventually-consistent, no CAS — accepted tradeoffs documented in `README.md`; the access model, security
  design notes and accepted risks live in `SECURITY.md` (keep it in step with any auth/gate change).

## Verify a change
`npm test` first (fast, no server). Then `npm run cf` and run `scripts/smoke.sh`, which does the flow below
(health, signed-out 401s, host sign-in via `devCode`, `isHost`, admin/guest APIs, sign-out) with its cookie jar in a
temp dir; one code per address per 60 s, so wait a minute between runs. By hand — sign in for real, there is no
bypass (`.dev.vars` makes `host@example.com` a host):
```bash
curl -X POST localhost:8788/api/auth/start -H 'content-type: application/json' -d '{"email":"host@example.com"}'   # devCode in the JSON
curl -c c.txt -X POST localhost:8788/api/auth/verify -H 'content-type: application/json' -d '{"email":"host@example.com","code":"NNNNNN"}'
curl -b c.txt localhost:8788/api/me          # guest.isHost === true
curl -b c.txt localhost:8788/api/admin/all   # 200 · without -b: 401
curl          localhost:8788/api/public      # 401 · with -b: 200
```
Then drive the UI with headless Chrome (CDP: launch with `--remote-debugging-port` and
`--remote-allow-origins=*`, navigate, run JS to open modals, capture screenshots). Worth checking after any
auth/gate change: signed-out `/` shows the envelope and **no date/time/venue**; `/registry` bounces; a
non-host sees no Host Dashboard link and is redirected off `/admin`; RSVP reopens prefilled; claim → "Claimed
by you" → undo; the admin email preview still opens and replays.

## Deploy
See **DEPLOY.md**. Needs: Cloudflare login, KV/R2 creation (KV id + `HOST_EMAILS` go in the gitignored
`wrangler.toml`), Resend domain verification + API key, and the production secrets (`TOKEN_SECRET`,
`RESEND_API_KEY`). No Zero Trust.
