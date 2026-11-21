# Staff two-step sign-in (TOTP)

> **Status:** living. **Last reviewed:** 2026-11-20. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Why: a staff account takeover is the highest-impact risk in `docs/trust/THREAT_MODEL.md` (A07). A sign-in link or code is enough to become that person, and sudo, imports and the admin pages are powerful. A second factor, a 6-digit code from an authenticator app, puts something a stolen email link cannot supply in front of the admin area.

It uses Supabase Auth's MFA (TOTP), switched on in production by `[remotes.prod.auth.mfa.totp]` in `supabase/config.toml` (and locally by `[auth.mfa.totp]`). No migration, no table: the factor lives in Supabase Auth.

## How it works

A session is `aal1` after a link or code sign-in and `aal2` once it has also passed a TOTP challenge. The rules are in `lib/staff-mfa.ts` (`staffMfaState`):

| The staff account | Session | Result |
|---|---|---|
| has a verified factor | aal2 | in |
| has a verified factor | aal1 | **challenge**: sent to `/mfa` for the code (always, whether or not the requirement is on) |
| no factor, requirement on | any | **enrol**: sent to `/mfa` to set one up |
| no factor, requirement off (today) | any | in, with a banner in the admin layout |

"Staff" is an admin or a community manager. Four places hold it, and a new admin entry point needs the same check (`.claude/rules/admin-route-protection.md`):

- the proxy (`lib/supabase/middleware.ts`): the token's `aal` claim and `user.factors` from the `getUser()` it already runs, so a factor removed in the dashboard counts at once;
- `requireAdminPage()` and `requireStaffPage()` (`lib/admin-auth.ts`): redirect through the `staffMfa` gate (`lib/gates.ts`) to `/mfa?next=<where they were going>`;
- `requireAdminAction()` and `requireStaffAction()`: return `{ ok: false, error: MFA_REQUIRED_ERROR }`;
- `requireAdmin()` (`lib/supabase/api-auth.ts`, admin API routes): `forbidden`.

The guards use `lib/staff-mfa.server.ts`: aal2 comes from the verified token (no network); only an aal1 session asks Supabase Auth for the user's factors. A failed read counts as "has a factor", so it fails toward the code screen. Sudo and role preview are not affected (they change the acting member or the effective role, not the signed-in staff member), and the audit log still records the real staff user.

## Screens

- **Settings, Account, "Two-step sign-in"** (`components/mfa/MfaPanel.tsx`): for every signed-in member, not while in sudo. Scan the QR code or type the key, confirm with a code, see the enrolled app, remove it (a `ConfirmDialog`). One authenticator app per account in the UI.
- **`/mfa`** (`app/mfa/page.tsx`, outside both route groups like `/no-access`): the code screen, or the set-up screen when the account has no factor. It follows the gate standard (`.claude/rules/gates-and-return-to.md`): the destination is carried through, and "Not now" goes to the dashboard.
- **Banner** in the admin layout for staff with no factor while the requirement is off.

## Turning the requirement on (owner)

It is off in code. In `config/app.ts`, set `staffMfaRequiredFrom` to an ISO instant with an offset, for example `"2027-02-01T00:00:00-05:00"`, and merge the change (it deploys like any code change; no migration). From that instant, staff without a factor are sent to the set-up screen instead of the admin area.

Do it in this order, so nobody is locked out:

1. Every admin and community manager sets it up (Settings, Account, Two-step sign-in) while the banner is showing. The date must be at least a week out, so the banner and a message to the team come first.
2. Confirm in the dashboard (Authentication, Users, each staff user's factors) that every staff account has a verified TOTP factor.
3. Set the date, merge, and watch the `main` run deploy.

To turn it off again, set it back to `null`. Staff who enrolled are still asked for their code.

Local development: `[auth.mfa.totp]` is on in `supabase/config.toml`, so you can enrol on the local stack (the code comes from any authenticator app, or compute it from the key with an RFC 6238 tool).

## If a staff member loses their device

They cannot pass the code check, and Settings needs the admin session too, so someone with Supabase project access removes the factor:

1. Check it is really them (not through the same email channel an attacker would use: ask on a call or in person).
2. In the Supabase dashboard: Authentication, Users, open the user, and delete their MFA factor (the factors section of the user). If the dashboard does not offer that, call the Auth admin API with the service role key from a trusted machine: `DELETE /auth/v1/admin/users/<user id>/factors/<factor id>` (list them with `GET /auth/v1/admin/users/<user id>/factors`). Never paste the key anywhere or into a script in the repo.
3. Tell them to sign out and in again, then set up a new authenticator app (Settings, Account, Two-step sign-in, or the `/mfa` screen they are sent to if the requirement is on).
4. Note the reset in the audit trail of whoever did it (staff note or the team's usual log), without secrets.

If the only admin is locked out, the same dashboard step is the way back in: it needs the project owner, which is why the provider organization has a second owner with MFA.

## Tests

`tests/lib/staff-mfa.test.ts` (states, date boundary, reading the session), `tests/lib/proxy-admin-guard.test.ts` (the proxy), `tests/components/pages/admin-auth.test.tsx` (the page and action guards, the banner), `tests/api/require-admin.test.ts` (API routes), `tests/components/MfaPanel.test.tsx` (enrol, confirm, remove, challenge), `tests/components/pages/mfa-page.test.tsx` (`/mfa`).

## Not built

Recovery codes, more than one authenticator app per account in the UI, WebAuthn keys, and asking for a fresh code before the most dangerous actions (sudo start, imports): see `docs/TODO.md`, "Supabase security checklist follow-ups".
