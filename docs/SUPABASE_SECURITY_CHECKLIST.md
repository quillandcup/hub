# Supabase production security checklist: where we stand

Evaluation of the production project against Supabase's [Production security checklist](https://supabase.com/docs/guides/security/production-checklist), done 2026-11-17. The general checklist (performance, availability, deployment, rate limits) is in `docs/SUPABASE_PRODUCTION_CHECKLIST.md`.

Sources: `supabase/config.toml`, the code in this repo, and read-only checks of production (`supabase db query --linked`, `supabase ssl-enforcement get --experimental`, `supabase network-restrictions get --experimental`), per `.claude/rules/verify-against-prod.md`. Each line says which. Status: **Done**, **Done (owner-reported)** (the CLI can't read it; the owner said so, with the date), **Partial**, **Gap**, **Accepted**, **Unchecked**.

## 1. Database

| Item | Status | Evidence and what to do |
|---|---|---|
| RLS on every table | Done | 0 tables without RLS in `public` and `bronze` (prod, 2026-11-18). A pgTAP test (`supabase/tests/database/security_guards.test.sql`) fails CI for a table without it. Policy detail is in the migrations (`docs/RLS_SECURITY.md` is out of date on policies). |
| Signed-out role and SECURITY DEFINER functions | Done | `anon` holds no table privileges (prod, 2026-11-18; `anon_has_no_table_privileges.test.sql`). 51 `SECURITY DEFINER` functions in `public` are callable by signed-in users (the same 51 that the advisor lists, `is_admin()` also by `anon`); each was read on 2026-11-18 and checks the caller or is a reviewed deliberate read, and the same test fails CI for a new one without a recognizable check. It proves a check exists, not that it is right (`docs/RLS_SECURITY.md`). |
| RLS and policies on replicated tables with sensitive data | Done | Published to Realtime: `chat_messages`, `chat_reactions`, `prickles` (prod). All three have RLS on, so `postgres_changes` only delivers rows the signed-in member may read. |
| Broadcast with Realtime Authorization for sensitive changes | Accepted (owner, 2026-11-18) | We use `postgres_changes`, not Broadcast, and `realtime.messages` has no policies (0, prod), so nothing is authorized there. The checklist's concern is that RLS does not filter `DELETE` events, which carry the primary key to every subscriber of the table. Messages and reactions both soft delete (`chat_toggle_reaction` sets `deleted_at`, so removal is an UPDATE that RLS filters; corrected 2026-11-18, this row earlier said reaction removals send DELETE events), so a `DELETE` reaches Realtime only on a hard delete, such as a data-removal or retention run, and then carries only an id, not content. Not checked: which maintenance paths hard delete from these three tables. It remains a gap against the letter of the checklist, accepted because the residual is one id and no content, and only on a hard delete. Policies on `realtime.messages` would not change that: Realtime Authorization applies to Broadcast and Presence, not to `postgres_changes`; closing it fully means moving chat to private Broadcast channels, which belongs with "Realtime cost and limits" in `docs/TODO.md`. Revisit together with "Realtime cost and limits" in `docs/TODO.md`; moving chat to server-sent Broadcast would fix both. |
| SSL enforcement | Done | `ssl-enforcement get`: `database: true` (prod). |
| Network restrictions | Accepted | `network-restrictions get`: allowed `0.0.0.0/0` and `::/0`, i.e. unrestricted (prod). The app reaches Postgres through the Data API and the pooler from Vercel functions, which do not call from a fixed address list we maintain, so an allow-list would risk breaking production. Direct database access is protected by the database password and SSL. Revisit if Vercel static IPs or a private link are adopted. |

## 2. Account and organization

| Item | Status | Evidence and what to do |
|---|---|---|
| MFA on the Supabase accounts (and on GitHub if used to sign in) | Done (owner-reported) | The owner reported on 2026-11-18 that MFA is required for the Supabase organization, so every member needs it. Not readable from the CLI. |
| MFA enforcement on the organization | Done (owner-reported) | Required for the organization as of 2026-11-18, reported by the owner. |
| More than one Owner | Done (owner-reported) | A second Owner, with MFA, was added on 2026-11-18, reported by the owner. |

## 3. Auth

| Item | Status | Evidence and what to do |
|---|---|---|
| Email confirmations | Done | `enable_confirmations = true` under `[remotes.prod.auth.email]` in `config.toml`. Sign-ups are also off (`enable_signup = false`; invite only). |
| Remove test phone numbers | Done (by config) | SMS sign-in is off and no `[auth.sms.test_otp]` is declared. Whether the dashboard holds one that config doesn't mention is Unchecked. |
| OTP expiry at 3600 s or lower | Gap (deliberate) | `otp_expiry = 86400` (24 h, the maximum), chosen so a link requested in the evening still works the next morning; the email copy says 24 hours. This is also the validity of invitation and recovery links. The risk is a longer window for a leaked or forwarded link. Accepted for now because members are invite-only, links are single-use, and scanners spending the link is the bigger real problem (see "Email link validity" in `docs/SUPABASE_PRODUCTION_CHECKLIST.md`). If the `/auth/confirm` work lands, lower it to 3600 and rely on the typed code. |
| MFA for app users, if needed | Partial | TOTP enroll and verify are on in prod (`[remotes.prod.auth.mfa.totp]`). The Hub has an enrol screen (Settings, Account) and a code check for staff that holds the admin pages, actions and API routes to aal2 for anyone who has a factor (`docs/STAFF_MFA.md`). Requiring a factor of every admin and community manager starts at `staffMfaRequiredFrom` in `app.config.ts`, unset today, so this stays Partial until the owner sets it. |
| Custom SMTP | Done | Resend, sender on our own domain (`[remotes.prod.auth.email.smtp]`). |

## 4. Threat review

| Item | Status | Evidence and what to do |
|---|---|---|
| Think through how an attacker could abuse the app | Done | `docs/THREAT_MODEL.md` (2026-11-17). |
| OWASP Top 10 review | Partial | `docs/THREAT_MODEL.md` (2026-11-17) is a static review of the code and configuration against the 2021 list; its open items are in `docs/TODO.md`, "Threat model follow-ups". Not covered: a policy-by-policy review of the RLS logic, live dynamic testing (nothing was attacked), and the authorization of the file upload routes beyond what the model read. |

## What to do next

Tracked in `docs/TODO.md`, "Supabase security checklist follow-ups": decide on OTP expiry, and consider Broadcast for chat (low priority: messages and reactions both soft delete, so only a hard delete by a maintenance job sends a DELETE event).

## Review again when

Someone joins or leaves the Supabase organization, a table is added to the Realtime publication, sign-ups are opened, or `[remotes.prod.auth]` changes.
