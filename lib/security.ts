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

export const SECURITY_EFFECTIVE = "2026-11-18";

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
        title: "Encrypted in transit: your browser to the Hub",
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
        title: "Encrypted in transit: the Hub to its database",
        status: "inPlace",
        member: "Every connection between the Hub and its database is encrypted with TLS, and the database refuses connections that are not.",
        staff: {
          how: "The app reaches the database only through the provider's HTTPS API and secure websockets. The provider's switch that rejects non-SSL connections to the database is on (read again from the provider's API with the CLI on 2026-11-18: database enforcement true) and is declared in supabase/config.toml, so CI's config push keeps it on. Direct Postgres connections (migrations in CI, the CLI, tooling) therefore must use SSL. Network access to the database is not restricted by address: the provider's setting allows every IPv4 and IPv6 address (read 2026-11-18). That is accepted, because the app reaches the database from serverless functions that have no fixed address list; a direct connection is protected by the database password and SSL.",
          evidence: [
            "supabase/config.toml (db.ssl_enforcement)",
            "docs/SUPABASE_SECURITY_CHECKLIST.md (SSL enforcement, network restrictions)",
            "live check, 2026-11-18: the provider's SSL-enforcement and network-restriction settings for the production database",
          ],
          checked: "2026-11-18",
          open: [
            "Network restrictions are open on purpose (accepted): an allow-list would risk breaking production while the app calls from addresses we do not control. Revisit if static addresses or a private link are adopted.",
          ],
        },
      },
      {
        id: "at-rest",
        title: "Encrypted at rest: the database, uploaded files and our settings",
        status: "provider",
        member:
          "Our hosting provider and our database provider both encrypt what they store on disk with AES-256, and that includes the database's backups. Our database provider encrypts all customer data at rest with AES-256, including the files you upload. The database's encryption keys are specific to our project and protected by hardware security modules. The keys and passwords we give our hosting provider are encrypted at rest too, and cannot be read back once they are saved.",
        staff: {
          how: "Database: the provider states that database data and backups are encrypted with AES-256, with keys generated per project and protected by FIPS 140-2 compliant hardware security modules, and destroyed if the project is deleted (its data residency and transfers FAQ, version dated 2026-10-06, read on 2026-11-17). Hosting: AES-256 at rest (provider documentation); environment variable values are encrypted at rest, and a variable marked sensitive is write-only after saving. The database provider's security page also says \"All customer data is encrypted at rest with AES-256 and in transit via TLS\" and that a project's Postgres database, Auth service and Storage objects are hosted in its region; neither that page nor the Storage documentation names Storage objects in an encryption sentence, so we read the general statement as covering uploaded files (a decision, 2026-11-18). Hosting: every variable our configuration declares as a secret that is set in production is stored as a Secret, which the provider documents as write-only after saving (checked 2026-11-18 from the hosting CLI's read-only listing of variable types, against env-vars.config.ts; none is stored as readable Config). These are the providers' statements, not something we tested.",
          evidence: [
            "env-vars.config.ts",
            "docs/ENV_MANAGEMENT.md",
            "provider documentation, read 2026-11-17: the database provider's data residency and transfers FAQ (at rest section) and the hosting provider's security documentation",
            "provider documentation, read 2026-11-18: the database provider's security page and Storage documentation, and the hosting provider's documentation on Secret and Config environment variables",
            "live check, 2026-11-18: the hosting provider's read-only listing of production variable types, compared with env-vars.config.ts",
          ],
          checked: "2026-11-18",
          open: [
            "The database provider's FAQ does not say who holds the keys or whether they rotate, and points to its data processing addendum (schedule 1) for full technical detail. Read that, and ask the provider for its SOC 2 report, before quoting more than the sentences above.",
          ],
        },
      },
      {
        id: "vault",
        title: "Stored tokens are kept in an encrypted vault",
        status: "inPlace",
        member:
          "A member's chat connection, and any other token the Hub must hand to someone else, is kept in an encrypted vault inside the database, and only the Hub's server can read it back.",
        staff: {
          how: "Supabase Vault (extension supabase_vault 0.3.1, read from production on 2026-11-17). Per the provider's documentation: authenticated encryption with associated data, one root key per Supabase project (64 hex characters, so 256 bits) held outside the database and shared by every secret in that project, each secret with its own random nonce; secrets stay encrypted in backups and replication streams. Vault is self-contained and does not depend on the pgsodium extension that is being deprecated, and uses the same per-project root key. Production, the development project that previews use (docs/ENV_MANAGEMENT.md) and each local stack are separate projects with separate keys, so a secret from one cannot be decrypted with another's key. Production check: the anon and authenticated roles can read neither the encrypted table nor the decrypted view; only the service role can. Our own table keeps only a pointer to each secret.",
          evidence: [
            "supabase/migrations/20261021000000_member_slack_connections.sql",
            "lib/slack-connect.ts",
            "docs/ENV_MANAGEMENT.md",
            "docs/TODO.md (Secrets at Rest)",
            "live check, 2026-11-17: the Vault extension version and which roles may read it (counts and privileges only, never values)",
          ],
          checked: "2026-11-17",
          open: [
            "The provider's management API returns a project's root key to its owner, so anyone holding a management token for the project can decrypt the vault outside the provider. CI holds such a token (see \"Keys and passwords\"), so it is as sensitive as the service key.",
            "The service role can read every vault secret, so a leaked service key exposes them. See \"Keys and passwords\".",
            "Confirm the development project (used by previews) holds no real member data. It has its own key, but a copy of production data there would be protected only by that project's.",
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
          how: "Self-signup is off and email confirmation is on. Access tokens last 3600 seconds; refresh tokens rotate on every use with a 10-second reuse window, after which an old one is refused. These are declared in supabase/config.toml and pushed by CI, and production inherits them. The sign-in cookies are Secure in every deployed build, SameSite=Lax, set for the exact host only (no Domain, so subdomains never receive them) and readable by the page's own scripts, because the browser client reads the session for chat and uploads (docs/TODO.md, \"Make the sign-in cookies HttpOnly\"). The proxy re-checks the session on every request and clears the cookies of a revoked one; server code then verifies the token against the project's keys. An admin can revoke a member's sessions. Sign-in, invitation and recovery links stay valid for 86400 seconds (24 hours, the provider's maximum), declared in supabase/config.toml and inherited by production. That is a deliberate trade-off, so a link requested in the evening still works the next morning, and the cost is a longer window for a link that leaks or is forwarded.",
          evidence: [
            "supabase/config.toml",
            "docs/SUPABASE_SECURITY_CHECKLIST.md (OTP expiry)",
            "lib/supabase/middleware.ts",
            "lib/supabase/cookie-options.ts",
            "lib/auth.ts",
            "app/api/admin/users/[id]/revoke-sessions/route.ts",
          ],
          checked: "2026-11-18",
          open: [
            "Sign-in links last 24 hours against the provider checklist's 1 hour. Accepted for now (invite-only, single-use links); lower it once a spent link has a typed-code fallback (docs/TODO.md, Supabase security checklist follow-ups).",
            "The sign-in cookies are not HttpOnly, so a script injected into a page could read the session. Making them HttpOnly means the server hands the browser a short-lived token instead (docs/TODO.md, \"Make the sign-in cookies HttpOnly\").",
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
          how: "Row-level security in Postgres, with admin pages and server actions each calling the admin check (never relying on the layout). Community managers open a fixed, read-only set of admin pages, and every new role starts with nothing. Data read in a member's name goes through the effective identity, so viewing as a member never widens access. Every table in the public and bronze schemas has row-level security (read from production on 2026-11-17: none without), and a database test now fails CI for a table without it. The signed-out database role holds no table privileges (read from production after the 2026-11-18 deploy: no table grants for it), a test pins that, and a new table gives it nothing by default. The functions that run with their owner's rights (SECURITY DEFINER) and can be called by signed-in users were each read on 2026-11-18: 51 in the public schema (all callable by signed-in users, and the admin check also by the signed-out role). Each one checks the caller (the current member, an admin or the service role) or is one of four deliberate, limited reads of other members' data (the member directory's alias list and its search, the writing a member chose to show on their profile, and each mentor's match counts). One more is a wrapper that only calls a checked function. A database test now fails CI for a new such function with no recognizable caller check, with one that does not pin its search path, or with any other signed-out one.",
          evidence: [
            ".claude/rules/admin-route-protection.md",
            "lib/admin-auth.ts",
            "lib/staff-access.ts",
            "tests/components/pages/admin-auth.test.tsx",
            "supabase/tests/database/security_guards.test.sql",
            "supabase/tests/database/anon_has_no_table_privileges.test.sql",
            "supabase/migrations/20270818000000_revoke_anon_table_privileges.sql",
            "docs/RLS_SECURITY.md (Table privileges, Security definer functions)",
            "live check, 2026-11-17 and 2026-11-18: counts of tables without row-level security, of table grants for the signed-out role and of callable SECURITY DEFINER functions in production (counts only)",
          ],
          checked: "2026-11-18",
          open: [
            "docs/RLS_SECURITY.md is out of date: it still says every signed-in user has full access. It should be rewritten from the policies. Nothing else relies on it.",
            "The definer-function test proves that a caller check exists in each function, not that it is right or complete. A reviewer still reads every new SECURITY DEFINER function in the pull request that adds it.",
            "A mentor's match count and first and last match dates can be read by any signed-in member (deliberate: badges need it and members cannot read the matches table). Confirm it matches what members were told.",
            "Chat uses Realtime row changes, and row-level security does not filter delete events: when a chat row is hard deleted, its id (only the id) is sent to every subscriber of that table. Low impact: messages and reactions are soft deleted, so only a hard delete by a maintenance job sends one. Details in docs/SUPABASE_SECURITY_CHECKLIST.md; the fix (server-sent Broadcast with its own authorization) is tracked in docs/TODO.md, Realtime cost and limits.",
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
          how: "Every variable is declared once with whether it is a secret and where it is synced; values live in git-ignored env files and are synced to the hosting provider's encrypted store, to GitHub's secrets or to the Vault. GitHub secret scanning and push protection are both on for the repository (read from GitHub's API on 2026-11-18; the extra generic-pattern and validity checks are off), so a key committed by mistake is flagged and a push that contains a known kind of one is blocked. Single-use sign-in tokens are stored as hashes. On API routes the server's database key and the scheduled-job secret are accepted only as an exact \"Bearer <secret>\" header, compared in constant time and never as a substring. Members' sessions are short-lived (see \"Signing in and sessions\"), but the server's database key (the service role) and the CI database password are long-lived: they do not expire or rotate on their own and change only when someone follows the rotation runbook.",
          evidence: ["env-vars.config.ts", "lib/supabase/api-auth.ts", "tests/lib/api-auth-secrets.test.ts", "docs/SECRET_ROTATION.md", "docs/ENV_MANAGEMENT.md", "docs/TODO.md (Secrets at Rest)", "live check, 2026-11-18: the repository's security settings from GitHub's API"],
          checked: "2026-11-18",
          open: [
            "The service-role key and the CI database password rotate only by hand: no schedule and no automatic rotation. Decide an interval (the runbook has the steps) and whether to move to keys the provider can rotate without downtime.",
            "The calendar feed link is a bearer token stored as a plain value, readable by its owner and, through row-level security, by admins. It is read-only, scoped to one member and can be replaced, so the risk is low. Options are in docs/TODO.md, Secrets at Rest.",
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
          how: "Fixed-window counters in the database (rate_limit_hit), used by the course comment action, the Slack sign-in action, the landing page opt-in, chat link previews and course playback tokens. Sign-in emails are limited by the provider: one per address per minute and 150 an hour for the whole project in production (supabase/config.toml, pushed by CI). No CAPTCHA is configured, which is acceptable while sign-ups are off; the hourly cap is shared, so a flood of sign-in requests could delay everyone's email for up to an hour.",
          evidence: ["lib/data/rate-limit.ts", "app/api/landing/opt-in/route.ts", "app/auth/slack/actions.ts", "supabase/config.toml", "docs/THREAT_MODEL.md", "tests/lib/api-route-auth.test.ts"],
          checked: "2026-11-18",
          open: [
            "Not every public or member-callable route has a limit. Each route's exposure has not been reviewed; start from the list of routes that are public in lib/supabase/middleware.ts.",
          ],
        },
      },
      {
        id: "outbound-fetch",
        title: "Fetching pictures and pages from other sites",
        status: "inPlace",
        member:
          "When the Hub shows a link preview or copies a picture from another website, it only visits ordinary public web addresses, never addresses inside our own network, and it gives up on anything slow or oversized.",
        staff: {
          how: "Every place that fetches an address someone else supplied (chat link previews and their pictures, member photo copies, book covers, imported landing pages) goes through one function. It allows only http(s) on ports 80 and 443, resolves the name itself and refuses private, loopback and link-local addresses (IPv4 hidden inside IPv6 too), then connects to the address it checked, so a name that answers differently the second time gets nothing. Redirects are followed by hand, at most three, and each hop is checked again. Size and time are capped. Chat pictures reach a viewer through a route that takes a message and a key rather than an address, and that serves a picture only to someone who can read the message. Calls to fixed provider hosts use the plain outbound wrapper, and a test fails on a new external request that skips it.",
          evidence: [
            "lib/net/safe-fetch.ts",
            "tests/lib/net/safe-fetch.test.ts",
            "app/api/chat/unfurl-image/route.ts",
            "tests/api/chat-unfurl-image.test.ts",
            "tests/lib/outbound-user-agent.test.ts",
            "docs/OUTBOUND_REQUESTS.md",
          ],
          checked: "2026-11-17",
          open: [],
        },
      },
      {
        id: "uploads",
        title: "Files people upload",
        status: "inPlace",
        member:
          "Files shared in chat are offered as downloads rather than opened inside the Hub, apart from ordinary pictures, so an uploaded file cannot run as part of a Hub page.",
        staff: {
          how: "The chat file route serves only PNG, JPEG, GIF, WebP and AVIF inline; every other type is sent as an attachment with a generic type, with X-Content-Type-Options: nosniff and a cleaned file name, so an uploaded HTML or SVG file is never rendered on the Hub's own address. Storage buckets are private except the member photo, chat avatar and custom emoji buckets, which are public to read and written only by the server (read from the production project's bucket list and storage policies on 2026-11-17). The feedback screenshot, help picture and link picture buckets also limit file types, and every bucket that takes uploads has a size cap except the three public ones.",
          evidence: [
            "app/api/chat/files/[messageId]/[fileId]/route.ts",
            "lib/chat/files.ts",
            "tests/api/chat-files.test.ts",
            "live check, 2026-11-17: the production project's storage buckets and storage policies",
          ],
          checked: "2026-11-17",
          open: [
            "The three public buckets (member photos, chat avatars, custom emoji) have no size or file-type limit at the storage layer. Only the server writes to them, so the limit has to be in the code that does.",
            "Most buckets that take uploads limit size but not file type (course files, event photos, media library). Decide whether to add allowed types there.",
          ],
        },
      },
      {
        id: "rich-text",
        title: "Formatted text is cleaned before it is shown",
        status: "inPlace",
        member:
          "Formatted text on course lessons and landing pages is reduced to a short list of safe formatting (headings, lists, links, emphasis) before it is stored, so it cannot carry scripts.",
        staff: {
          how: "Rich text is cleaned to an allowlist: no scripts, styles, event handlers, iframes or forms, links limited to http(s) and mailto and opened without passing on the opener. Landing page text is cleaned when it is saved and again before every public render. Lesson text is cleaned when it is imported and again every time it is shown. A search of the app, components and emails on 2026-11-18 found three places that write raw HTML into a page (the member lesson page, the admin lesson preview and the landing page text block); each cleans the text first.",
          evidence: [
            "lib/landing/sanitize.ts",
            "lib/courses/sanitize.ts",
            "lib/courses/process.ts",
            "tests/lib/courses-sanitize.test.ts",
            "lib/courses/admin.ts",
            "tests/lib/landing-data.test.ts",
          ],
          checked: "2026-11-18",
          open: [
            "Nothing in the browser yet blocks an injected script: the cleaning is the only barrier. The enforcing policy does not limit scripts (see Browser protections).",
          ],
        },
      },
      {
        id: "browser",
        title: "Browser protections",
        status: "inPlace",
        member:
          "Browsers are told to use only HTTPS, to load pictures only from sources the Hub lists, to submit forms only to the Hub, and not to show Hub pages inside other sites. They are also told not to guess file types, to share less about where you came from when you follow a link, and not to give pages your camera, microphone or location.",
        staff: {
          how: "Strict-Transport-Security from the hosting provider's default, and on every response an enforcing Content-Security-Policy (pictures, plugins, base tag, form targets and framing), X-Content-Type-Options, Referrer-Policy, X-Frame-Options and Permissions-Policy. The policy was report-only from 2026-11-10 to 2026-11-17; the one picture host its reports showed was added before it was enforced, and violations still go to Sentry. A second policy for scripts and styles, with a per-request nonce, is built and tested but not sent yet: it was tried report-only for a day and paused because Next's own scripts did not get the nonce on the hosting platform (docs/TODO.md, CSP for scripts and styles). Not covered by the enforcing policy: scripts, styles, connection, frame, media and font sources.",
          evidence: ["next.config.ts", "proxy.ts", "lib/csp.ts", "tests/lib/csp.test.ts", "Sentry CSP reports, 2026-11-10 to 2026-11-17"],
          checked: "2026-11-18",
          open: [
            "The enforcing policy covers pictures, plugins, the base tag, form targets and framing. The script and style policy is paused until the nonce reaches Next's scripts on the hosting platform, then it needs a clean run of reports before it is enforced, and connect, frame, media and font sources after that (docs/TODO.md, CSP for scripts and styles).",
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
