import type { ComplianceStatus } from "@/lib/compliance";

/**
 * What the Security pages list: the public one (`/security`, for members) and the staff one
 * (`/admin/security`, with more detail) read this one list, so they cannot drift.
 *
 * Every line must be true of the code today. `member` is what a member reads: plain, no file names. `staff` is
 * the extra detail for the team and is public-safe on purpose (the repo is public): where a thing is enforced
 * and tested, when it was last checked against the code, and what is still open. Never put anything here that
 * helps an attacker or names a person, an account, a key or a host.
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
    /** Where it is enforced: files, docs and tests, relative to the repo root. */
    evidence: readonly string[];
    /** When this row was last checked against the code (YYYY-MM-DD, Eastern). */
    checked: string;
    /** What is still open: each starts a `docs/TODO.md` entry or says what to look at. Empty when nothing is. */
    open: readonly string[];
  };
}

export const SECURITY_ITEMS: readonly SecurityItem[] = [
  {
    id: "sign-in",
    title: "Signing in",
    status: "inPlace",
    member: "Joining is by invitation. Each time you use the Hub we check that your sign-in is still valid, and staff can end a member's sessions if an account is at risk.",
    staff: {
      how: "Invite-only auth. The proxy checks the session on every request and clears the cookies of a revoked one; server code then verifies the token against the project's keys. An admin can revoke a member's sessions.",
      evidence: ["lib/supabase/middleware.ts", "lib/auth.ts", "app/api/admin/users/[id]/revoke-sessions/route.ts"],
      checked: "2026-11-17",
      open: [],
    },
  },
  {
    id: "access",
    title: "Who can see and change what",
    status: "inPlace",
    member: "The database itself decides who can read each row, so a page can't show you what you aren't meant to see. Staff access is limited by role, and admin pages and actions check the role again every time.",
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
    id: "secrets",
    title: "Keys and passwords",
    status: "inPlace",
    member: "The keys that connect the Hub to other services are kept out of the code, and we have a written procedure for replacing them. The Slack connection you give the Hub is stored encrypted and used only by the Hub's server.",
    staff: {
      how: "Every variable is declared once with whether it is a secret and where it is synced. A credential we must hand to someone else (a member's Slack token) lives in the database vault behind service-role-only functions, with only a pointer in our table. A credential we only need to recognise (single-use sign-in tokens) is stored as a hash. A runbook covers rotation after an exposure.",
      evidence: ["env-vars.config.ts", "docs/SECRET_ROTATION.md", "docs/ENV_MANAGEMENT.md", "docs/TODO.md (Secrets at Rest)"],
      checked: "2026-11-17",
      open: [
        "The calendar feed link is a bearer token stored as a plain value, readable by its owner and, through row-level security, by admins. It is read-only, scoped to one member and can be replaced, so the risk is low. Options are in docs/TODO.md, Secrets at Rest.",
      ],
    },
  },
  {
    id: "webhooks",
    title: "Messages from other services",
    status: "inPlace",
    member: "When Slack, Zoom, our email provider or our video provider tells the Hub something, we first check that the message really came from them.",
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
    member: "A few actions that could be abused, such as comments, signing in with Slack and the sign-up form on a landing page, are rate limited.",
    staff: {
      how: "Fixed-window counters in the database (`rate_limit_hit`), used by the course comment action, the Slack sign-in action, the landing page opt-in, chat link previews and course playback tokens.",
      evidence: ["lib/data/rate-limit.ts", "app/api/landing/opt-in/route.ts", "app/auth/slack/actions.ts"],
      checked: "2026-11-17",
      open: ["Not every public or member-callable route has a limit. Each route's exposure has not been reviewed; start from the list of routes that are public in `lib/supabase/middleware.ts`."],
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
      open: ["An admin can still merge a failing pull request with \"Merge without waiting for requirements\". That is intended as a break-glass option and is not recorded anywhere else."],
    },
  },
  {
    id: "browser",
    title: "Browser protections",
    status: "working",
    member: "We tell browsers which sources a Hub page may load from. For now it only reports what it would block.",
    staff: {
      how: "A Content-Security-Policy header on every response, in report-only mode.",
      evidence: ["next.config.ts", "lib/csp.ts"],
      checked: "2026-11-17",
      open: ["Enforce it once the reports are quiet. Where to start: the report volume, then `lib/csp.ts`."],
    },
  },
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
    member: "Changes to many of the things stored in the Hub are recorded in a change history, including what staff do while viewing the Hub as a member.",
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
];

export const SECURITY_STATUSES: readonly ComplianceStatus[] = ["inPlace", "working"];
