# Supabase production checklist: where we stand

> **Status:** living. Kept up to date with the code; if it is wrong, fix it. Review: quarterly.

Evaluation of the production project against Supabase's [Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod), done 2026-11-17. The security half of that checklist lives on a separate page ([Production security checklist](https://supabase.com/docs/guides/security/production-checklist)), evaluated in `docs/checklists/SUPABASE_SECURITY_CHECKLIST.md`.

Sources: `supabase/config.toml`, the docs and CI in this repo, and read-only checks of production (`supabase db query --linked`, `supabase db advisors --linked`, `supabase backups list`), per `.claude/rules/verify-against-prod.md`. Each line says which. Status: **Done**, **Partial**, **Gap**, **N/A**.

## Performance

| Item | Status | Evidence and what to do |
|---|---|---|
| Indexes for common query patterns | Partial | Hot queries are checked ad hoc with `pg_stat_statements` (installed in prod). The performance advisor reports 99 warnings (prod, today): 30 `auth_rls_initplan` (policies calling `auth.<fn>()` per row instead of `(select auth.<fn>())`), 68 `multiple_permissive_policies`, 1 `duplicate_index`. None is an error, but the initplan ones are cheap to fix and the box is memory-bound (below). Tracked in `docs/TODO.md`, "Supabase Performance Advisor Warnings". |
| Load test, ideally on staging | Gap | No load test in the repo (no k6 or similar), and there is no staging database. The launch (2026-11-02) went out without one. Tracked in `docs/TODO.md`, "Load test the Hub before the next big announcement". |
| Upgrade compute if needed | Partial | Small compute, `max_connections` 90 (prod). Memory pressure is known and documented in `docs/TODO.md`, "Production database memory, and the jump from Small to Medium". Compute size is not config as code. |
| Traffic surge notice to support (Team and Enterprise) | N/A | Only offered on those plans; the launch is past. |
| PITR if the database will exceed 4 GB | Done early | Database is 806 MB (prod), and PITR is already on (`pitr_enabled: true`, `walg_enabled: true`, `us-east-2`). |

## Availability

| Item | Status | Evidence and what to do |
|---|---|---|
| Custom SMTP for auth emails | Done | `[remotes.prod.auth.email.smtp]` in `config.toml`: Resend, sender on our own domain. CI refuses to push config if `RESEND_API_KEY` is empty (`.claude/rules/config-as-code.md`). |
| Not on a plan that pauses projects | Done (inferred) | PITR and Small compute only exist on a paid plan (`docs/infrastructure/DEPLOYMENT.md`, "Plans and headroom"). The CLI doesn't print the plan name; confirm it on the billing page. |
| Backups and recovery point | Done | PITR on; `backups list` shows no daily backups but a physical backup range of about a week. Restore steps: `docs/infrastructure/DEPLOYMENT.md`. A restore has not been rehearsed. |
| Disk durability, read replicas | Accepted | No replica. At about 80 members and 806 MB, PITR covers durability; availability to a disk failure is not a goal worth the cost. |
| Support access | Unknown | Depends on the plan name above. |

## Deployment

| Item | Status | Evidence and what to do |
|---|---|---|
| Deploy from `main`, not by hand from a laptop | Done, differently | Not through Supabase's GitHub integration: CI's `push-migrations` job pushes migrations, then config, then the deploy runs (`docs/infrastructure/DEPLOYMENT.md`, `docs/decisions/CI_MIGRATION_ORDERING.md`). Same intent, and ordering is controlled. |
| Branching to test migrations | Gap (deliberate) | Evaluating branching is on the TODO list (`docs/TODO.md`, the Supabase branching entry). Migrations are checked by `pnpm check:migrations`, squawk and the local stack in CI instead. |

## Rate limits, resources and abuse

| Item | Status | Evidence and what to do |
|---|---|---|
| Auth email rate limit | Done | `email_sent = 150`/hour in `[remotes.prod.auth.rate_limit]`, pinned so a config push can't cut it to the local default of 2. Every sign-in link is an auth email, so this is the number that matters. Sign-ups are off (`enable_signup = false`; invite only), so the "30 new users per hour" cap doesn't apply. |
| Other auth limits (OTP, verify, refresh) | Done (defaults) | Left at Supabase defaults except the pinned ones. Not load-tested. |
| Realtime limits | Gap | Realtime is used (chat messages and reactions, prickles, `LiveRefresh`), but the limits page has not been checked against our use. Worse: the Realtime WAL-polling query is the top query in `pg_stat_statements` by total time (about 1.9 million calls, 14,000 s total, 7.5 ms mean; stats since June), ahead of every app query, on a database already short on memory. Tracked in `docs/TODO.md`, "Realtime cost and limits". |
| CAPTCHA on sign-in endpoints | Gap (low risk) | `[auth.captcha]` is not configured. With sign-ups off, only the magic-link request and password flows are exposed, and the 60 s per-address limit and the 150/hour email cap bound the abuse. Revisit if sign-in email abuse shows up. |
| Email link validity (scanners, link tracking) | Done (watch the first days) | The sign-in, invitation and recovery emails link to `/auth/confirm?token_hash=...&type=...`, which checks the one-time token on the server (`verifyOtp`), so the link works in any browser or device, not only the one that asked. A real browser navigation (`Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document`) signs in at once; anything else (a mail scanner, a link checker, a prefetcher) is sent to a Continue page whose button is the only thing that spends the token, so a scanner no longer burns the link. The typed code in the same email stays as the fallback, and `/auth/callback` still accepts links sent before the change (they lasted 24 hours, so none is still valid). Click tracking is off, which is what keeps links intact ("Email Routing on Separate Subdomains" in `docs/TODO.md`). Links and codes last one hour (`otp_expiry = 3600`, lowered from 86400 on 2026-11-18); a spent or expired one is replaced from the login page, which also re-sends a fresh invitation to someone invited who never accepted. |

## Security advisor (prod, today)

`supabase db advisors --linked --type security` reports 54 warnings and no errors: 51 and 1 for `SECURITY DEFINER` functions executable by signed-in or anonymous users, 1 for a mutable function `search_path`, and 1 for a long OTP expiry. The OTP expiry is deliberate (24 hours, so a link requested in the evening still works; see the comment in `config.toml`). The definer-function ones are described in `docs/TODO.md`, "Supabase Security Advisories (Skipped)", which is out of date on the count (it names two functions). RLS is on for every public table (0 of them without it, prod).

## Not covered

- The [Production security checklist](https://supabase.com/docs/guides/security/production-checklist): see `docs/checklists/SUPABASE_SECURITY_CHECKLIST.md`.
- Dashboard-only facts the CLI can't read: plan name, support tier.
- The [Shared Responsibility Model](https://supabase.com/docs/guides/deployment/shared-responsibility-model).

## Review again when

The plan, compute size or member count changes, before a large announcement, or after any change to `[remotes.prod]` in `config.toml`.
