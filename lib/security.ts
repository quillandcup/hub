import type { ComplianceStatus } from "@/lib/compliance";

/**
 * What the Security pages list: the public one (`/security`, for members) and the staff one
 * (`/admin/security`, with more detail) read this one list, so they cannot drift.
 *
 * Security says what we do: encryption in transit and at rest, how keys and sessions are handled, backups and
 * recovery. Compliance (`lib/compliance.ts`) says which laws, standards and frameworks we follow.
 *
 * Every line must be true of the code or of the live system today. `member` is what a member reads: plain,
 * no file names, and no provider names (providers are described by role; see the staff page for the names).
 * `staff` is the extra detail for the team and is public-safe on purpose (the repo is public): how it works,
 * where it is enforced and tested, when it was last checked, and what is still open. Never put anything here that
 * helps an attacker or names a person, an account, a key, a project or a host. A fact read from the live system
 * (headers, a handshake, a provider setting) says so and carries its date; a fact taken from a provider's
 * documentation says "provider documentation".
 */

export const SECURITY_EFFECTIVE = "2026-11-17";

export interface SecurityItem {
  id: string;
  title: string;
  status: ComplianceStatus;
  /** What a member reads. */
  member: string;
  staff: {
    /** How it works, for the team. */
    how: string;
    /** Where it is enforced: files, docs and tests relative to the repo root, or a note saying which live check it came from. */
    evidence: readonly string[];
    /** When this row was last checked against the code or the live system (YYYY-MM-DD, Eastern). */
    checked: string;
    /** What is still open: each starts a `docs/TODO.md` entry or says what to look at. Empty when nothing is. */
    open: readonly string[];
  };
}

export interface SecurityGroup {
  id: string;
  title: string;
  intro: string;
  items: readonly SecurityItem[];
}

export const SECURITY_GROUPS: readonly SecurityGroup[] = [
  {
    id: "encryption",
    title: "Encryption",
    intro: "How information is protected as it travels and while it is stored.",
    items: [
      {
        id: "in-transit",
        title: "Encrypted in transit",
        status: "inPlace",
        member:
          "Everything between your browser and the Hub is encrypted with TLS 1.2 or 1.3, using ciphers that give forward secrecy. Browsers are told to use only HTTPS for the next two years, and a plain http address is redirected to https.",
        staff: {
          how: "The hosting provider's edge ends TLS and supports versions 1.2 and 1.3 only (provider documentation). Checked live on 2026-11-17: TLS 1.3 negotiated TLS_AES_128_GCM_SHA256 and TLS 1.2 negotiated ECDHE-RSA-AES128-GCM-SHA256, so session keys are 128-bit AES-GCM with an ephemeral key exchange (forward secrecy). Every response carried Strict-Transport-Security with max-age=63072000 (two years), and plain HTTP answered with a 308 redirect to HTTPS. Which cipher a visitor gets depends on their browser.",
          evidence: [
            "next.config.ts (no transport headers of our own: HSTS is the hosting provider's default)",
            "live check, 2026-11-17: response headers and TLS handshakes against the production host",
          ],
          checked: "2026-11-17",
          open: [
            "HSTS has no includeSubDomains and no preload: the provider's default covers only this host. Fine while no other subdomain serves the Hub; revisit before adding one.",
            "Refusal of TLS 1.0 and 1.1 rests on the provider's documentation. Our own probe cannot prove it, because the client used cannot speak those versions.",
          ],
        },
      },
      {
        id: "database-in-transit",
        title: "The Hub talks to its database over HTTPS",
        status: "working",
        member: "Every request from the Hub to its database service goes over HTTPS or a secure websocket.",
        staff: {
          how: "The app reaches the database only through the provider's HTTPS API and secure websockets. Direct Postgres connections (migrations in CI, the CLI, tooling) are made by our own tools; nothing on the server side forces them to use SSL, because the provider's switch that rejects non-SSL connections is off (read from the provider's API on 2026-11-17).",
          evidence: [
            "supabase/config.toml (the commented ssl_enforcement block)",
            "live check, 2026-11-17: the provider's SSL-enforcement setting for the production database",
          ],
          checked: "2026-11-17",
          open: [
            "Turn SSL enforcement on for the production database. The provider says enabling it needs a brief restart with a few minutes of downtime, so schedule it, then declare it in supabase/config.toml so the CI config push keeps it on.",
          ],
        },
      },
      {
        id: "at-rest",
        title: "Encrypted at rest",
        status: "provider",
        member:
          "Our hosting provider encrypts what it stores on disk with AES-256, and the keys and settings we give it are encrypted at rest.",
        staff: {
          how: "Hosting: AES-256 at rest (provider documentation); environment variable values are encrypted at rest, and a variable marked sensitive is write-only after saving. Database: the provider's platform encrypts its disks, but we have not captured its own statement of algorithm and key size, so this page does not quote one for the database.",
          evidence: ["env-vars.config.ts", "docs/ENV_MANAGEMENT.md"],
          checked: "2026-11-17",
          open: [
            "Capture the database provider's statement on disk encryption (algorithm, key size) from its security documentation or audit report before quoting it anywhere.",
            "Whether the production secrets are marked sensitive (write-only) in the hosting provider has not been checked.",
          ],
        },
      },
      {
        id: "vault",
        title: "Stored tokens are encrypted one by one",
        status: "inPlace",
        member:
          "A member's chat connection, and any other token the Hub must hand to someone else, is encrypted in a vault inside the database, and only the Hub's server can read it back.",
        staff: {
          how: "Supabase Vault (extension supabase_vault 0.3.1, read from production on 2026-11-17). Per the provider's Vault documentation: authenticated encryption with associated data (libsodium), a root key per project (64 hex characters, so 256 bits) kept outside the database, and secrets stay encrypted in backups and replication streams. Production check: the anon and authenticated roles can read neither the encrypted table nor the decrypted view; only the service role can. Our own table keeps only a pointer to each secret.",
          evidence: [
            "supabase/migrations/20261021000000_member_slack_connections.sql",
            "lib/slack-connect.ts",
            "docs/TODO.md (Secrets at Rest)",
            "live check, 2026-11-17: the Vault extension version and which roles may read it (counts and privileges only, never values)",
          ],
          checked: "2026-11-17",
          open: [
            "The Vault documentation describes a per-project root key; this project runs Vault 0.3.1. Confirm the key arrangement and algorithm for that version before quoting key sizes outside this page.",
            "The service role can read every vault secret, so a leaked service key exposes them. See \"Keys and passwords\".",
          ],
        },
      },
    ],
  },
  {
    id: "access",
    title: "Access",
    intro: "Who can get in, and what they can see once they are in.",
    items: [
      {
        id: "sign-in",
        title: "Signing in and sessions",
        status: "inPlace",
        member:
          "Joining is by invitation. A sign-in lasts an hour at a time and renews in the background, each renewal replaces the last, and staff can end a member's sessions if an account is at risk.",
        staff: {
          how: "Self-signup is off and email confirmation is on. Access tokens last 3600 seconds; refresh tokens rotate on every use with a 10-second reuse window, after which an old one is refused. These are declared in supabase/config.toml and pushed by CI, and production inherits them. The proxy re-checks the session on every request and clears the cookies of a revoked one; server code then verifies the token against the project's keys. An admin can revoke a member's sessions.",
          evidence: [
            "supabase/config.toml",
            "lib/supabase/middleware.ts",
            "lib/auth.ts",
            "app/api/admin/users/[id]/revoke-sessions/route.ts",
          ],
          checked: "2026-11-17",
          open: [
            "Two-factor sign-in (TOTP) is switched on in the project's settings, but the Hub has no screen to enrol in or require it. Decide whether staff accounts should need it.",
          ],
        },
      },
      {
        id: "access-control",
        title: "Who can see and change what",
        status: "inPlace",
        member:
          "The database itself decides who can read each row, so a page can't show you what you aren't meant to see. Staff access is limited by role, and admin pages and actions check the role again every time.",
        staff: {
          how: "Row-level security in Postgres, with admin pages and server actions each calling the admin check (never relying on the layout). Community managers open a fixed, read-only set of admin pages, and every new role starts with nothing. Data read in a member's name goes through the effective identity, so viewing as a member never widens access.",
          evidence: [
            ".claude/rules/admin-route-protection.md",
            "lib/admin-auth.ts",
            "lib/staff-access.ts",
            "tests/components/pages/admin-auth.test.tsx",
            "supabase/tests/database (pgTAP: RLS and SECURITY DEFINER functions)",
          ],
          checked: "2026-11-17",
          open: [
            "docs/RLS_SECURITY.md is out of date: it still says every signed-in user has full access. It should be rewritten from the policies. Nothing else relies on it.",
            "There is no automated check that every new table has row-level security turned on; new tables are covered by review and the pgTAP tests of each feature.",
          ],
        },
      },
      {
        id: "service-keys",
        title: "Keys and passwords for the Hub's own services",
        status: "working",
        member:
          "The keys that let the Hub's server reach its services are kept out of the code and encrypted at rest, and there is a written procedure for replacing them after any exposure.",
        staff: {
          how: "Every variable is declared once with whether it is a secret and where it is synced; values live in git-ignored env files and are synced to the hosting provider's encrypted store, to GitHub's secrets or to the Vault. Single-use sign-in tokens are stored as hashes. Members' sessions are short-lived (see \"Signing in and sessions\"), but the server's database key (the service role) and the CI database password are long-lived: they do not expire or rotate on their own and change only when someone follows the rotation runbook.",
          evidence: ["env-vars.config.ts", "docs/SECRET_ROTATION.md", "docs/ENV_MANAGEMENT.md", "docs/TODO.md (Secrets at Rest)"],
          checked: "2026-11-17",
          open: [
            "The service-role key and the CI database password rotate only by hand: no schedule and no automatic rotation. Decide an interval (the runbook has the steps) and whether to move to keys the provider can rotate without downtime.",
            "The calendar feed link is a bearer token stored as a plain value, readable by its owner and, through row-level security, by admins. It is read-only, scoped to one member and can be replaced, so the risk is low. Options are in docs/TODO.md, Secrets at Rest.",
            "Whether GitHub secret scanning and push protection are on for the repository has not been checked.",
          ],
        },
      },
    ],
  },
  {
    id: "resilience",
    title: "Backups and recovery",
    intro: "What happens if something goes wrong with the data.",
    items: [
      {
        id: "backups",
        title: "Backups and point-in-time recovery",
        status: "inPlace",
        member:
          "The database is backed up continuously, so it can be restored to any moment in the last 7 days. Our provider documents a worst case of about two minutes of changes lost.",
        staff: {
          how: "Point-in-time recovery is on (read from the provider's API on 2026-11-17: WAL archiving enabled, with a rolling seven days of recoverable history; the database is in the United States). Provider documentation: a daily snapshot plus write-ahead log files uploaded about every two minutes, so a worst-case recovery point of two minutes. While it is on the provider takes no separate daily backups.",
          evidence: [
            "docs/DEPLOYMENT.md",
            "docs/SHORT_IDS_PLAN.md (take a recovery point before a risky migration)",
            "live check, 2026-11-17: the provider's backup and point-in-time-recovery status for the production database",
          ],
          checked: "2026-11-17",
          open: [
            "Restore is a one-line pointer in docs/DEPLOYMENT.md. No rehearsed restore or recovery-time estimate is recorded; write the steps and rehearse one onto a scratch project.",
            "Whether uploaded files (storage buckets) are covered by the same backups has not been confirmed.",
          ],
        },
      },
    ],
  },
  {
    id: "application",
    title: "The application and how it changes",
    intro: "How the Hub defends itself, and how a change reaches it.",
    items: [
      {
        id: "webhooks",
        title: "Messages from other services",
        status: "inPlace",
        member:
          "When the chat, live-session, email or video services we connect to tell the Hub something, we first check that the message really came from them.",
        staff: {
          how: "Each inbound webhook verifies its signature or shared secret, comparing in constant time. On a deployed build a missing secret rejects every request instead of switching the check off. Stripe is only read through its API: there is no Stripe webhook.",
          evidence: ["lib/webhook-auth.ts", "lib/slack-signature.ts", "app/api/webhooks/"],
          checked: "2026-11-17",
          open: [],
        },
      },
      {
        id: "abuse",
        title: "Limits on abuse",
        status: "working",
        member: "A few actions that could be abused, such as comments, signing in through chat and the sign-up form on a landing page, are rate limited.",
        staff: {
          how: "Fixed-window counters in the database (`rate_limit_hit`), used by the course comment action, the Slack sign-in action, the landing page opt-in, chat link previews and course playback tokens.",
          evidence: ["lib/data/rate-limit.ts", "app/api/landing/opt-in/route.ts", "app/auth/slack/actions.ts"],
          checked: "2026-11-17",
          open: [
            "Not every public or member-callable route has a limit. Each route's exposure has not been reviewed; start from the list of routes that are public in `lib/supabase/middleware.ts`.",
          ],
        },
      },
      {
        id: "browser",
        title: "Browser protections",
        status: "working",
        member:
          "Browsers are told to use only HTTPS, and which sources a Hub page may load from. For now the second only reports what it would block, and does not block anything yet.",
        staff: {
          how: "Strict-Transport-Security from the hosting provider's default, and a Content-Security-Policy in report-only mode on every response. Checked live on 2026-11-17: the response carries those two and does not send X-Content-Type-Options, Referrer-Policy, X-Frame-Options or Permissions-Policy.",
          evidence: ["next.config.ts", "lib/csp.ts", "live check, 2026-11-17: response headers from the production host"],
          checked: "2026-11-17",
          open: [
            "Send X-Content-Type-Options: nosniff, Referrer-Policy and Permissions-Policy from `headers()` in next.config.ts. They are cheap and low risk.",
            "Enforce the CSP once its reports are quiet. Nothing enforces anti-framing today: frame-ancestors is only in the report-only policy and there is no X-Frame-Options.",
          ],
        },
      },
      {
        id: "changes",
        title: "How changes reach the Hub",
        status: "inPlace",
        member: "Every change goes through automated tests and code scanning before it goes live, and nobody can push straight to the live code.",
        staff: {
          how: "The default branch only takes pull requests whose required checks pass (unit tests, database tests and build, migration check, coverage on new code, code scanning), and every review thread, bots' included, must be resolved. Dependencies are updated weekly by Dependabot. Settings live in the repo and are pushed by script, so a change to them is reviewed too.",
          evidence: ["github-repo-config.yml", ".github/workflows/ci.yml", ".github/dependabot.yml"],
          checked: "2026-11-17",
          open: [
            "An admin can still merge a failing pull request with \"Merge without waiting for requirements\". That is intended as a break-glass option and is not recorded anywhere else.",
          ],
        },
      },
    ],
  },
  {
    id: "operations",
    title: "Watching and recording",
    intro: "How we notice problems and what is written down.",
    items: [
      {
        id: "monitoring",
        title: "Watching for problems",
        status: "inPlace",
        member: "We watch for errors and for scheduled jobs that don't run, and the team is alerted. Error recordings mask what is typed on screen.",
        staff: {
          how: "Error and performance monitoring with masked recordings and server-side scrubbing (configured in the repo), heartbeat monitors on scheduled jobs, uptime and end-to-end checks, and operations alerts posted to a staff channel.",
          evidence: ["docs/SENTRY_CONFIG.md", "sentry-config.yml", "lib/cron-heartbeats.ts", "checkly.config.ts", "docs/SLACK_OPERATIONS_ALERTS.md"],
          checked: "2026-11-17",
          open: [],
        },
      },
      {
        id: "history",
        title: "A record of changes",
        status: "inPlace",
        member:
          "Changes to many of the things stored in the Hub are recorded in a change history, including what staff do while viewing the Hub as a member.",
        staff: {
          how: "A database trigger on each audited table writes the audit entries, whichever path made the change; the Activity Log shows them to admins, with a view for changes to who can read messages. Break-glass reads of private chat are done by hand and must be recorded as the Privacy page promises (no in-app tool yet).",
          evidence: ["docs/ACTIVITY_AND_AUDIT_LOG.md", "app/(admin)/admin/activity", "supabase/tests/database/audit_log.test.sql"],
          checked: "2026-11-17",
          open: [
            "Only the tables that were chosen are audited, not every table. A new table is audited only if its feature adds the trigger.",
            "Break-glass access has no in-app tool, so the promise on the Privacy page rests on a person recording it by hand.",
          ],
        },
      },
    ],
  },
];

/** Every row, in page order. */
export const SECURITY_ITEMS: readonly SecurityItem[] = SECURITY_GROUPS.flatMap((group) => group.items);

export const SECURITY_STATUSES: readonly ComplianceStatus[] = ["inPlace", "provider", "working"];
