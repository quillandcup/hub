# Decision: no network restrictions from Vercel to Supabase

**Status: decided not to do this (2026-11-18).** Supabase network restrictions stay open (`0.0.0.0/0` and `::/0`). This page records why, what was checked, what was not, and what would change the answer. The checklist line is in `docs/SUPABASE_SECURITY_CHECKLIST.md` (section 1, "Network restrictions").

## The idea

Pair Vercel Static IPs (Pro add-on, about $100/month plus metered Private Data Transfer on traffic routed through them) with Supabase Network Restrictions, so only Vercel's two fixed addresses could reach the database.

## Why we are not doing it

1. **It would not cover how we talk to Supabase.** The app uses `@supabase/supabase-js` over HTTPS (PostgREST, Auth, Storage, Realtime). Supabase Network Restrictions apply only to direct Postgres and pooler connections (ports 5432 and 6543), never to the HTTP APIs. We found no direct Postgres driver or connection string in `app`, `lib`, `scripts` or the workflows, so there is nothing for an allow-list to protect. We would pay for a control on a door we don't use. An earlier version of the checklist line said the app uses the pooler; that was wrong.
2. **The HTTPS side can't be locked by IP on Supabase.** Closing it would mean putting our own reverse proxy in front of the project URL, which is new infrastructure to run for little gain.
3. **Some callers can't come from the static addresses anyway** (not audited, see below):
   - The browser talks to Supabase directly (`NEXT_PUBLIC_SUPABASE_URL` is bundled): sign-in and MFA, Realtime for chat, signed uploads for chat files, media and lesson files. These come from members' own addresses and can never be allow-listed.
   - `proxy.ts` (the Next.js middleware) refreshes the session with Supabase Auth. Vercel routing middleware never uses Static IPs, so its calls would come from dynamic addresses.
   - Builds use dynamic addresses unless "Use for builds" is switched on.
4. **Static IPs are a shared pool.** Other Vercel customers in the region share the same addresses, so the allow-list would not isolate us from them. Credentials and RLS would still carry the security, as they do now.

## What protects the data instead

- RLS on every table in `public` and `bronze`; `anon` holds no table privileges (checked by pgTAP in CI).
- The service-role key is server-only; the browser holds only the publishable key.
- SSL enforced on the database. Sign-ups off. MFA for staff (`docs/STAFF_MFA.md`).

## What was and was not checked

- Checked: `network-restrictions get` on production (unrestricted); no `pg` driver or database URL in the app, scripts or workflows.
- **Not audited:** every browser-side use of the Supabase client (the known ones are listed above; there may be more), and every call `proxy.ts` makes. If this decision is ever reopened, list them first.

## What would change the answer

- A direct Postgres connection from Vercel (an ORM or driver). Then Static IPs plus restrictions make sense for that path.
- A compliance requirement for IP allow-listing, which would mean the reverse-proxy route.
- Supabase adding IP restrictions or private networking for the Data API.
