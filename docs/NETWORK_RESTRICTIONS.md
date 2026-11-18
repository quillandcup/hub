# Network restrictions from Vercel to Supabase: not feasible

**Decision (2026-11-18): we don't restrict the Supabase project by network address, because it can't be done for how we use Supabase.** The restrictions stay open (`0.0.0.0/0` and `::/0`). The checklist line is in `docs/SUPABASE_SECURITY_CHECKLIST.md` (section 1, "Network restrictions").

## Why it isn't technically feasible

- **We talk to Supabase over HTTPS, and Supabase can't lock that down by address.** The app uses `@supabase/supabase-js` against PostgREST, Auth, Storage and Realtime. Supabase Network Restrictions cover only direct Postgres and pooler connections (ports 5432 and 6543), never those HTTP APIs. We found no direct Postgres driver or connection string in `app`, `lib`, `scripts` or the workflows, so there is nothing an allow-list would protect.
- **Not every caller could come from Vercel's addresses anyway.** Members' browsers call Supabase directly (`NEXT_PUBLIC_SUPABASE_URL` is bundled), and Vercel's routing middleware never uses Static IPs, so `proxy.ts` calls Supabase Auth from dynamic addresses. We have not audited every browser-side or middleware call; the known ones are sign-in and MFA, Realtime for chat, and signed uploads.

## Cost

Vercel Static IPs are a Pro add-on at about $100/month plus metered Private Data Transfer. We would not pay that even if it applied.

## What protects the data instead

RLS on every table in `public` and `bronze`, `anon` holding no table privileges (pgTAP in CI), a server-only service-role key, SSL enforced on the database, sign-ups off, and MFA for staff (`docs/STAFF_MFA.md`).

## When to revisit

Only if the app starts using a direct Postgres connection, or Supabase adds address restrictions for its HTTP APIs.
