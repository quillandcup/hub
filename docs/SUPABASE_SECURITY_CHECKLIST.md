# Supabase production security checklist: where we stand

Evaluation of the production project against Supabase's [Production security checklist](https://supabase.com/docs/guides/security/production-checklist), done 2026-11-17. The general checklist (performance, availability, deployment, rate limits) is in `docs/SUPABASE_PRODUCTION_CHECKLIST.md`.

Sources: `supabase/config.toml`, the code in this repo, and read-only checks of production (`supabase db query --linked`, `supabase ssl-enforcement get --experimental`, `supabase network-restrictions get --experimental`), per `.claude/rules/verify-against-prod.md`. Each line says which. Status: **Done**, **Partial**, **Gap**, **Accepted**, **Unchecked** (the CLI can't read it; needs a dashboard look).

## 1. Database

| Item | Status | Evidence and what to do |
|---|---|---|
| RLS on every table | Done | 0 tables without RLS in `public` and `bronze` (prod, today). Policy design: `docs/RLS_SECURITY.md`; new tables are covered by pgTAP (`.claude/rules/testing-requirements.md`). |
| RLS and policies on replicated tables with sensitive data | Done | Published to Realtime: `chat_messages`, `chat_reactions`, `prickles` (prod). All three have RLS on, so `postgres_changes` only delivers rows the signed-in member may read. |
| Broadcast with Realtime Authorization for sensitive changes | Partial | We use `postgres_changes`, not Broadcast, and `realtime.messages` has no policies (0, prod), so nothing is authorized there. The checklist's concern is that RLS does not filter `DELETE` events: a delete of a `chat_messages` or `chat_reactions` row is sent to every subscriber of the table, carrying only the primary key with the default replica identity. That leaks that a row id was deleted, not its content, but it is a gap against the letter of the checklist. Revisit together with "Realtime cost and limits" in `docs/TODO.md`; moving chat to server-sent Broadcast would fix both. |
| SSL enforcement | Done | `ssl-enforcement get`: `database: true` (prod). |
| Network restrictions | Accepted | `network-restrictions get`: allowed `0.0.0.0/0` and `::/0`, i.e. unrestricted (prod). The app reaches Postgres through the Data API and the pooler from Vercel functions, which do not call from a fixed address list we maintain, so an allow-list would risk breaking production. Direct database access is protected by the database password and SSL. Revisit if Vercel static IPs or a private link are adopted. |

## 2. Account and organization

| Item | Status | Evidence and what to do |
|---|---|---|
| MFA on the Supabase accounts (and on GitHub if used to sign in) | Unchecked | Not readable from the CLI. Owner to confirm each person with dashboard access has MFA (and 2FA on GitHub if that is how they sign in). |
| MFA enforcement on the organization | Unchecked | Needs a Pro or higher plan (we are on a paid plan, `docs/DEPLOYMENT.md` "Plans and headroom") and the organization settings page. |
| More than one Owner | Unchecked | Organization > Team. Owner to confirm. |

## 3. Auth

| Item | Status | Evidence and what to do |
|---|---|---|
| Email confirmations | Done | `enable_confirmations = true` under `[remotes.prod.auth.email]` in `config.toml`. Sign-ups are also off (`enable_signup = false`; invite only). |
| Remove test phone numbers | Done (by config) | SMS sign-in is off and no `[auth.sms.test_otp]` is declared. Whether the dashboard holds one that config doesn't mention is Unchecked. |
| OTP expiry at 3600 s or lower | Gap (deliberate) | `otp_expiry = 86400` (24 h, the maximum), chosen so a link requested in the evening still works the next morning; the email copy says 24 hours. This is also the validity of invitation and recovery links. The risk is a longer window for a leaked or forwarded link. Accepted for now because members are invite-only, links are single-use, and scanners spending the link is the bigger real problem (see "Email link validity" in `docs/SUPABASE_PRODUCTION_CHECKLIST.md`). If the `/auth/confirm` work lands, lower it to 3600 and rely on the typed code. |
| MFA for app users, if needed | Partial | TOTP enroll and verify are on in prod (`[remotes.prod.auth.mfa.totp]`). Whether staff or admins are required to use it is not checked here; the app has no admin-MFA enforcement that this pass found. |
| Custom SMTP | Done | Resend, sender on our own domain (`[remotes.prod.auth.email.smtp]`). |

## 4. Threat review

| Item | Status | Evidence and what to do |
|---|---|---|
| Think through how an attacker could abuse the app | Partial | RLS review in `docs/RLS_SECURITY.md`, admin route protection, a report-only CSP, and the trust pages exist. No single written threat model. |
| OWASP Top 10 review | Gap | No documented pass. Tracked in `docs/TODO.md`, "Supabase security checklist follow-ups". |

## What to do next

Tracked in `docs/TODO.md`, "Supabase security checklist follow-ups": confirm the three account and organization items in the dashboard, decide on OTP expiry, decide on Broadcast for chat, and write the OWASP pass.

## Review again when

Someone joins or leaves the Supabase organization, a table is added to the Realtime publication, sign-ups are opened, or `[remotes.prod.auth]` changes.
