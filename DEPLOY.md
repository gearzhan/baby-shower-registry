# Deployment guide — Cloudflare Pages

Everything runs on Cloudflare. Steps that need a browser login or the Cloudflare/Resend dashboard are
marked 🧑 (you do them); the rest are `wrangler` commands you can run in this repo.

There is **no Cloudflare Zero Trust / Access** in this setup. The dashboard is protected by the same sign-in
as the rest of the site: a host is a guest whose email is in `HOST_EMAILS`.

## 0. Prerequisites
- A Cloudflare account, with your domain's DNS on Cloudflare (needed for Resend verification).
- A [Resend](https://resend.com) account.
- `npm install` already run in this repo.

## 1. 🧑 Log in to Cloudflare
```bash
npx wrangler login
```
Opens a browser to authorize Wrangler.

## 2. Create the KV namespace and R2 bucket
```bash
npx wrangler kv namespace create BS_KV
npx wrangler r2 bucket create babyshower-media
```
Create your own config from the template, then copy the KV `id` from the first command into it:
```bash
cp wrangler.example.toml wrangler.toml   # gitignored — never commit it
```
`wrangler.toml` → `[[kv_namespaces]] id = "..."` (replacing the placeholder). The R2 `bucket_name` is already
`babyshower-media`.

## 3. 🧑 Resend: verify your sending domain + API key
1. Resend dashboard → **Domains → Add Domain** → enter your domain.
2. Add the DNS records it shows (SPF/DKIM) in **Cloudflare → your domain → DNS**. Wait for "Verified".
3. **API Keys → Create** → copy the key (used in step 5).
4. Choose a From address on that domain, e.g. `Alex & Sam <invites@yourdomain.com>`.

Email is load-bearing now: it is the *only* way anyone — including you — gets into the site.

## 4. First deploy (creates the Pages project)
```bash
npm run build
npx wrangler pages deploy dist --project-name babyshower
```
Your site's address is `https://<project-name>.pages.dev` — Cloudflare adds a suffix if that name is taken, and the
project page in the Pages dashboard shows the real one. The `https://<hash>.….pages.dev` link wrangler prints after each
deploy is that one deployment only; drop the leading `<hash>.` to get the site address. You can add a custom domain
later in the Pages dashboard.

## 5. Set production variables & secrets
Non-secret vars live in **`wrangler.toml` → `[vars]`** (your gitignored copy) — edit them there, not in the dashboard.
`wrangler pages deploy` uploads `[vars]` with the build and **overwrites whatever the dashboard has**,
so a value set only in the dashboard is silently lost on the next `npm run deploy`.

| Name | Value |
|---|---|
| `EMAIL_MODE` | `resend` |
| `RESEND_FROM` | `Alex & Sam <invites@yourdomain.com>` |
| `HOST_EMAILS` | `you@example.com,partner@example.com` |
| `PUBLIC_BASE_URL` | `https://yourdomain.com` (or the `<project-name>.pages.dev` address from step 4, without a deployment hash) |

⚠️ **`HOST_EMAILS` is the only key to the dashboard.** Every address in it is always on the guest list (it is
re-injected on every read), so a fresh KV still has a host who can sign in. `PUBLIC_BASE_URL` must be right too: it
is the base of every invitation link.

Secrets never go in `wrangler.toml` (not even your gitignored copy) — set them via CLI:
```bash
npx wrangler pages secret put RESEND_API_KEY --project-name babyshower   # paste the Resend key
npx wrangler pages secret put TOKEN_SECRET   --project-name babyshower   # paste a long random string
```
⚠️ **`TOKEN_SECRET` signs every session and every invitation link.** Without it, nobody can sign in at all
(it fails closed). Rotating it signs everyone out and voids every invitation link already sent.

## 6. Deploy with production vars
```bash
npm run deploy
```

## 7. Verify live (end-to-end)
1. Open `/` signed out — you should get the envelope, and after opening it a sign-in box. Confirm there is
   **no date, time, venue or registry** anywhere on that page.
2. Sign in with your host email → a real 6-digit code arrives → you land on the invitation, and the footer
   shows **Host Dashboard**.
3. Open `/admin` → the four tabs load, and the header chip shows your name.
4. **Guests tab:** add a guest → **Send** → confirm the invitation email arrives, with the full event details
   and an **Open Invitation** button.
5. Click that button from the email: it should land on the envelope and offer a code with no typing.
6. As that guest: RSVP → confirm both hosts get an "RSVP received" email. Reopen RSVP → the form comes back
   **prefilled** and the button reads *Update RSVP*.
7. **Registry:** open a gift → *I'll bring this gift* → it reads **Claimed by you**. Both hosts get a "Gift
   claimed" email. Click *I changed my mind — undo* → both hosts get a "Gift available again" email.
8. Confirm that guest sees **no Host Dashboard link**, and that typing `/admin` sends them back to the
   invitation.
9. **Design tab:** upload a background photo (or a short muted video) → check the invitation.

## If you ever lock yourself out
You can't. `getGuests()` (`functions/lib/kv.js`) force-merges every `HOST_EMAILS` address back onto the
roster on **every read**, even when the `guests` key already exists — so a host is always on the list and can
always sign in, regardless of what's stored.

> ⚠️ **Do not delete the `guests` KV key as a "fix."** It no longer does anything useful (hosts are re-injected
> on read anyway) and it **erases the entire real guest roster** — every guest, their `sentAt` flags, and their
> identities — revoking all guest sessions and stranding their `rsvp:`/`claim:` records (re-added guests get
> fresh ids). If you think you're locked out, check `HOST_EMAILS` in `wrangler.toml` and `TOKEN_SECRET` first.

## Notes
- The site starts from generic demo data (`functions/lib/seed-data.js`): placeholder event details and a few
  sample gifts with placeholder images. Replace them in the dashboard — your edits persist to KV, and gift photos
  you upload go to R2. Keep real details out of the repo.
- **Add your Wisteria artwork (optional).** The invitation starts on the Garden theme, which needs no artwork. To
  offer Wisteria Ink, put your own portrait WebP at `public/themes/wisteria.webp` before `npm run deploy` (it is
  gitignored, so it stays out of your commits): 1200×1691 aspect ratio, with a light, empty centre and the decoration
  kept to the edges, because the invitation text is overlaid in dark olive from about 23% down (see README →
  Features). Without it that theme shows a plain paper card.
- The guest list starts with just the hosts — add real guests in the dashboard.
- The site is `noindex` (won't appear in search); share the link directly with guests.
- If you previously had a Cloudflare Access application over `/admin` + `/api/admin`, **delete it** — do that
  *after* confirming you can sign in with the new flow.
