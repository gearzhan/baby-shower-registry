# Security policy

## Supported versions

This is a small, self-hosted, single-event app. Only the latest commit on the `main` branch is supported — fixes
land there, and there are no maintained release branches. If you run your own copy, pull `main` and redeploy.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** (GitHub's private vulnerability reporting, which creates a draft security advisory
only the maintainers can see). If that button isn't there, open an issue titled **"Security contact request"**
with no details at all, and a maintainer will open a private advisory and invite you to it. In the report, please
include:

- what an attacker can do, and who the attacker is (anyone on the internet / a signed-in guest / a host);
- the request(s) or steps that reproduce it, against a local `npm run cf` if possible;
- the commit you tested.

This project is maintained on a best-effort basis. We aim to acknowledge a report within a week, agree on a fix
and a disclosure date with you through the advisory, and credit you in it unless you prefer not to be.

Please test only against your own deployment or a local one — never against someone else's live event site, which
holds real guests' names and email addresses.

## How access works (in brief)

- **The whole site is behind a guest sign-in.** Signed out, only the landing page (baby + hosts, no date, time,
  venue or registry), `/api/me` (the same teaser), `/api/health`, the sign-in endpoints and `/api/media/*`
  respond; every other API route returns 401.
- **Sign-in is an emailed 6-digit code.** The guest list is the whitelist: a code is only ever sent to an address
  on it. Codes come from a CSPRNG, live 10 minutes, are single use, have a 60 s resend cooldown per address and a
  site-wide daily send cap; 5 wrong guesses void the code and lock the address for 15 minutes.
- **The session is a 7-day sliding HttpOnly cookie** (`SameSite=Lax`, `Secure` over https), renewed only by
  `GET /api/me`. `SameSite=Lax` is what blocks CSRF on every cookie-authenticated write.
- **Tokens are HMAC-SHA256 signed with `TOKEN_SECRET` and carry a required type** — `s` (session) or `i`
  (invitation link). The verifier takes the expected type as a required argument, so an invitation link can never
  be replayed as a session, and an invitation link by itself never signs anyone in (it only says which guest the
  code should be mailed to). Without `TOKEN_SECRET` nothing can be signed or verified: sign-in fails closed.
- **Every request re-resolves the guest from the roster**, so removing a guest revokes their session at once.
  Sessions and invitation links also carry a session version (`sv`): changing a guest's email bumps it, which ends
  every session and voids every invitation link and pending code issued for the old address.
- **A host is a guest whose email is in `HOST_EMAILS`** (deploy configuration, not data). Host-only routes
  (`/api/admin/*`) return 401 when signed out and 403 for everyone else; the browser-side redirect is cosmetic.
  Hosts can't be removed from the guest list and their email can't be changed from the dashboard.
- **Privacy rules are enforced on the server**, not just hidden in the UI: prices when `showPrices` is off,
  other guests' claimer names unless `showClaimerNames` is on, and the host-only received / thanked marks are
  stripped from guest responses; guests never see other guests' email addresses.

## Security design notes

- **Changing a guest's email signs out whoever had the old address.** The email change bumps the guest's `sv`,
  which ends every session issued for them (within KV propagation, ~60 s); invitation links mailed to the old
  address stop working (`invalid_invite`), and `auth/verify` only accepts a code while the guest's current email is
  still the address it was sent to. Their RSVP and claims stay with them (the guest id doesn't change). A host's
  email can't be changed, and no guest can be moved onto an address already on the list — hosts included, because
  host rights are granted by email. Tokens issued before `sv` existed count as version 0.
- **Received / Thanked marks are host-only.** They ride on the `claim:` record but are merged only into the
  host-gated `/api/admin/all`; `/api/registry` strips them too, and an idempotent re-claim echoes only
  `{guestId, name, at}`. A guest can't undo a claim the host has marked received (409, neutral copy), and that check
  runs after the ownership 403 so non-claimers learn nothing. Each mark carries the `at` of the claim the host was
  looking at, so a stale dashboard can't tick a claim someone else has made since.
- **Copying a store image into R2 is a server-side fetch, kept narrow on purpose.** Only a host can trigger it,
  and the URL is the item's already-saved image link, never one from the request. It fetches `https://` on the
  default port only, refuses IP literals, single-label names and `localhost` / `.local` / `.internal`-style hosts,
  re-checks every redirect against the same rules (at most 3 hops; https → http is refused), gives up after 10 s,
  and stops reading at 8 MB. The stored type comes from the file's magic bytes (JPEG / PNG / GIF / WebP / AVIF only —
  never SVG or HTML), `/api/media` serves it with `nosniff`, and the fetched bytes, headers and final URL are never
  returned to the caller. No cookies or Referer are sent upstream. Residual: under `wrangler pages dev` the fetch
  runs on your own machine, so a public hostname that resolves to a LAN address (DNS rebinding) can't be detected —
  it is blind and needs a signed-in host. Production fetches run from Cloudflare's edge.
- **Uploads refuse SVG** (it can carry script and `/api/media` is same-origin) and are capped at 8 MB for images,
  30 MB for video.
- **CSV exports guard against formula injection**: any cell starting with `=`, `+`, `-`, `@`, Tab, CR or LF is
  prefixed with an apostrophe.
- **Calendar files can't be injected into**: event text is escaped per RFC 5545 and control characters are
  stripped, so host-entered text can't start a new `.ics` property.
- **The sign-in code is only echoed back (`devCode`) for local development** — it needs both `EMAIL_MODE` other than
  `resend` *and* a `localhost` / `127.0.0.1` `PUBLIC_BASE_URL`, so one misconfigured variable in production can't
  turn into an authentication bypass.
- **Secrets never live in the repository.** `TOKEN_SECRET` and `RESEND_API_KEY` are set with
  `wrangler pages secret put`, and local secrets go in `.dev.vars`, which is gitignored. Your deploy configuration
  (`wrangler.toml`: host addresses, sender name, domain, KV id) is your own copy of `wrangler.example.toml` — it is
  listed in `.gitignore` and the public repository does not track one. CI runs a gitleaks scan for secrets on every
  push and pull request.

## Accepted risks

These are deliberate trade-offs for a private, few-dozen-guest, single-event site. Reports that only restate them
are still welcome if you can show a practical attack that goes further.

- **Admin access rests on an emailed code plus a 7-day cookie — no SSO, no MFA.** Whoever controls a host's
  mailbox controls the dashboard.
- **The code's brute-force defence is best-effort.** The wrong-guess counter is a non-atomic KV read-modify-write
  (parallel guesses can all read the same count), and requesting a fresh code lifts the lockout, so what really
  bounds guessing is the 900k code space over a 10-minute life, the 60 s resend cooldown and Cloudflare's edge
  rate limiting. If this ever needs to be stronger, raise the code entropy rather than trust the counter.
- **KV is eventually consistent with no compare-and-set.** Two guests claiming the same gift within the
  propagation window (~60 s) can both succeed; a revoked session, a deleted guest or a closed RSVP / registry can
  take up to that long to reach every edge; two admin edits to the same single-key collection at the same moment
  can lose one update.
- **`/api/media/*` is not behind the sign-in.** Object keys are random and only ever appear inside signed-in
  responses, but anyone who is given a media URL can open it.
- **The invitation email carries the date, time and venue.** A forwarded email reveals them; the sign-in protects
  the registry, the RSVP list and anyone who never received an email.
