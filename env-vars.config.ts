// env-vars.config.ts
//
// Single source of truth for every environment variable this project uses outside of
// local dev (see .env.example for the local .env.local template). Declares, per var:
// its type (config or secret), and which systems it gets synced to.
//
// scripts/sync-to-vercel.ts, scripts/sync-to-github.ts, and scripts/sync-vault-secrets.ts
// all read this file instead of maintaining their own hardcoded var lists -- that
// duplication is what let VERCEL_DEPLOY_HOOK_URL linger as a GitHub secret after it was
// replaced, and let .env.example drift out of sync with what's actually required. Add or
// remove a var here and every sync script picks it up automatically.
//
// `group` is also the canonical section ordering for .env.example and the value files below --
// they're grouped and commented to match this array's order and each var's `description`, so
// there's one layout to keep in sync instead of several independent ones.
//
// Values themselves are NOT stored here -- they live in gitignored dotenv files:
//   .env.shared   values that are the same in every environment (one Zoom/Kajabi/Google/Slack
//                 account, ...); the base for every target
//   .env.preview  Vercel Preview overrides (e.g. its own Supabase project)
//   .env.prod     Vercel Production overrides, plus CI/ops credentials (GitHub, Vault)
// A var set in .env.preview/.env.prod overrides .env.shared for that target. Shared config
// that's also fine to publish goes in app.config.ts instead (committed, not an env var).
// This file is just the schema: name, secrecy, and destinations. SOPS-encrypting the value
// files so they can be committed is a planned follow-up, tracked separately.

import { CRON_HEARTBEATS } from "./lib/cron-heartbeats";

/**
 * A Vercel environment the sync manages. Vercel's "development" target (read only by
 * `vercel dev` / `vercel env pull`) isn't used -- local dev runs on .env.local.
 */
export type VercelTarget = "preview" | "production";

export type Destination =
  /** Synced via `vercel env add <name> <target> --type <the var's type>`. */
  | { readonly kind: "vercel"; readonly target: VercelTarget }
  /** Synced via `gh secret set` (type "secret") or `gh variable set` (type "config"). */
  | { readonly kind: "github" }
  /**
   * Synced into Supabase Vault (`vault.decrypted_secrets`), read by SQL/PL-pgSQL/pg_cron.
   * `vaultName` is the name SQL code looks it up by, independent of this env var's name.
   */
  | { readonly kind: "vault"; readonly vaultName: string };

export interface EnvVarSpec {
  readonly name: string;
  /** Section heading this var is grouped under in env-vars.config.ts and every .env* file. */
  readonly group: string;
  readonly description: string;
  /**
   * "secret" for credentials/keys/tokens that grant access or bypass protections: stored
   * write-only wherever the destination supports it (a Vercel Secret, a GitHub secret), so
   * no one can read them back. "config" for identifiers, channel/account IDs, and values
   * designed to be public (NEXT_PUBLIC_* by Next.js convention, Sentry DSNs by Sentry's
   * design): readable after saving (a Vercel Config var, a GitHub variable).
   *
   * A var the production *build* reads must not be a Vercel "secret". CI builds production
   * with `vercel pull` + `vercel build`, and `vercel pull` writes the literal placeholder
   * "[SENSITIVE]" for Secret values (vercel/vercel#17514), which the build then uses. A
   * Sensitive NEXT_PUBLIC_* var baked that placeholder into every page on 2026-09-25 and
   * broke Supabase access for every visitor. At runtime, prebuilt deployments do get the
   * real Secret values (verified 2026-09-29 with a throwaway preview var). So NEXT_PUBLIC_*
   * vars are always "config", and build-only secrets (SENTRY_AUTH_TOKEN) go to GitHub and
   * are passed to the CI build step instead of living in Vercel.
   */
  readonly type: "config" | "secret";
  readonly destinations: readonly Destination[];
}

const vercelAllEnvs: readonly Destination[] = [
  { kind: "vercel", target: "preview" },
  { kind: "vercel", target: "production" },
];

export const ENV_VARS: readonly EnvVarSpec[] = [
  // --- Supabase ------------------------------------------------------------------------------
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    group: "Supabase",
    description: "Supabase project URL. Public by design.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    group: "Supabase",
    description:
      "Supabase anon key. Public by design -- RLS is what protects data, not this key's secrecy.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    group: "Supabase",
    description: "Bypasses RLS. Server-only.",
    type: "secret",
    destinations: vercelAllEnvs,
  },

  // --- Zoom ----------------------------------------------------------------------------------
  {
    name: "ZOOM_ACCOUNT_ID",
    group: "Zoom",
    description: "Zoom account identifier.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_CLIENT_ID",
    group: "Zoom",
    description: "Zoom OAuth app client ID.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_CLIENT_SECRET",
    group: "Zoom",
    description: "Zoom OAuth app client secret.",
    type: "secret",
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_WEBHOOK_SECRET_TOKEN",
    group: "Zoom",
    description: "Verifies Zoom webhook signatures.",
    type: "secret",
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_USER_EMAIL",
    group: "Zoom",
    description: "Zoom account email used for API calls.",
    type: "config",
    destinations: vercelAllEnvs,
  },

  // --- Kajabi --------------------------------------------------------------------------------
  {
    name: "KAJABI_CLIENT_ID",
    group: "Kajabi",
    description: "Kajabi OAuth app client ID.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "KAJABI_CLIENT_SECRET",
    group: "Kajabi",
    description: "Kajabi OAuth app client secret.",
    type: "secret",
    destinations: vercelAllEnvs,
  },
  {
    name: "KAJABI_SITE_ID",
    group: "Kajabi",
    description: "Kajabi site identifier.",
    type: "config",
    destinations: vercelAllEnvs,
  },

  // --- Google Calendar -------------------------------------------------------------------------
  {
    name: "GOOGLE_CALENDAR_ID",
    group: "Google Calendar",
    description: "Google Calendar ID synced for events.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "GOOGLE_SERVICE_ACCOUNT_KEY",
    group: "Google Calendar",
    description: "Full Google service account JSON key.",
    type: "secret",
    destinations: vercelAllEnvs,
  },

  // --- Google OAuth (per-user consent, e.g. Photos Picker) -----------------------------------
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    group: "Google OAuth",
    description:
      "Google OAuth Web Client ID (per-user consent flows, e.g. Photos Picker).",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_SECRET",
    group: "Google OAuth",
    description: "Google OAuth Web Client secret.",
    type: "secret",
    destinations: vercelAllEnvs,
  },

  // --- Slack -----------------------------------------------------------------------------------
  {
    name: "SLACK_BOT_TOKEN",
    group: "Slack",
    description: "Slack bot OAuth token.",
    type: "secret",
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_SIGNING_SECRET",
    group: "Slack",
    description:
      "Verifies requests from Slack (events, interactions, /hub). Slack sign-in refuses to issue links without it.",
    type: "secret",
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_FEEDBACK_CHANNEL_ID",
    group: "Slack",
    description: "Channel ID feedback-widget submissions post to.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_NEW_BOOKS_CHANNEL_ID",
    group: "Slack",
    description: "Channel ID for new-book staff notifications. Optional.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_NEW_AWARDS_CHANNEL_ID",
    group: "Slack",
    description: "Channel ID for new-award staff notifications. Optional.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_DEV_USER_ID",
    group: "Slack",
    description: "Slack member ID that redirected test-mode DMs go to.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_TEAM_ID",
    group: "Slack",
    description: "Workspace ID (T...) for slack:// links to the app's Home tab (Slack sign-in). Optional.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_APP_ID",
    group: "Slack",
    description:
      "Slack app ID (A...). In the app, for slack:// links to the app's Home tab (Slack sign-in); optional there. In CI, the app whose manifest the push-slack-manifest job replaces (GitHub variable); required there.",
    type: "config",
    destinations: [...vercelAllEnvs, { kind: "github" }],
  },
  {
    name: "SLACK_TEST_MODE",
    group: "Slack",
    description: "Overrides default DM-redirect behavior outside production.",
    type: "config",
    destinations: vercelAllEnvs,
  },

  // --- Web Push --------------------------------------------------------------------------------
  {
    name: "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    group: "Web Push",
    description:
      "VAPID public key (URL-safe base64) the browser subscribes with for Browser notifications. Public by design. Generate the pair once with `npx web-push generate-vapid-keys`; changing it invalidates every existing subscription.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "VAPID_PRIVATE_KEY",
    group: "Web Push",
    description:
      "VAPID private key matching NEXT_PUBLIC_VAPID_PUBLIC_KEY; signs the pushes the server sends. Without either key the Browser channel can't reach anyone.",
    type: "secret",
    destinations: vercelAllEnvs,
  },

  // --- Stripe ----------------------------------------------------------------------------------
  {
    name: "STRIPE_API_KEY",
    group: "Stripe",
    description: "Stripe secret API key.",
    type: "secret",
    destinations: vercelAllEnvs,
  },

  // --- Admin & Cron ------------------------------------------------------------------------------
  {
    name: "SUDO_SECRET",
    group: "Admin & Cron",
    description: "Signing secret for the admin sudo cookie.",
    type: "secret",
    destinations: vercelAllEnvs,
  },
  {
    name: "CRON_SECRET",
    group: "Admin & Cron",
    description: "Authenticates Vercel's own native cron job requests.",
    type: "secret",
    destinations: vercelAllEnvs,
  },
  {
    name: "CRON_INTERNAL_SECRET",
    group: "Admin & Cron",
    description:
      "Authenticates Supabase pg_cron -> internal API route calls via pg_net.",
    type: "secret",
    destinations: [
      ...vercelAllEnvs,
      { kind: "vault", vaultName: "writing_nudge_cron_secret" },
    ],
  },

  // --- Analytics & Monitoring ------------------------------------------------------------------
  {
    name: "NEXT_PUBLIC_GA_ID",
    group: "Analytics & Monitoring",
    description:
      "GA4 measurement ID. Public by design. Production only: app/layout.tsx skips GA when it's unset, so testing on previews isn't tracked.",
    type: "config",
    destinations: [{ kind: "vercel", target: "production" }],
  },
  {
    name: "NEXT_PUBLIC_SENTRY_DSN",
    group: "Analytics & Monitoring",
    description:
      "Sentry DSN for the browser, server and edge configs alike (one var: NEXT_PUBLIC_ vars are readable server-side too). Public by design -- a write-only ingest endpoint. Unset disables Sentry.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "NEXT_PUBLIC_SENTRY_ENVIRONMENT",
    group: "Analytics & Monitoring",
    description:
      "Sentry environment tag (production / preview) for browser, server and edge events alike -- what separates production errors from preview ones (the DSN is shared). Explicit because Sentry's own Vercel detection never reaches the browser bundle CI builds for production.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "SENTRY_AUTH_TOKEN",
    group: "Analytics & Monitoring",
    description:
      "Build-time secret for uploading production source maps. A GitHub secret passed to CI's `vercel build` step, not a Vercel var: the production build runs in CI and can't read Vercel Secret values (see `type` above). Preview builds skip source map upload without it.",
    type: "secret",
    destinations: [{ kind: "github" }],
  },
  {
    name: "ALERTS_EMAIL",
    group: "Analytics & Monitoring",
    description:
      "Engineering alerts address for this environment. The GitHub copy (from .env.prod) is what Checkly alerts at `checkly deploy` -- the monitors watch production. The Vercel copies are for app-side alerting per environment.",
    type: "config",
    destinations: [...vercelAllEnvs, { kind: "github" }],
  },

  ...Object.values(CRON_HEARTBEATS).map(
    (heartbeat): EnvVarSpec => ({
      name: heartbeat.envVar,
      group: "Analytics & Monitoring",
      description: `Checkly heartbeat ping URL for ${heartbeat.path}, copied from the Checkly monitor after \`checkly deploy\`. Unset = no ping. Production only so manual preview runs don't mask a missed production run. See lib/cron-heartbeats.ts.`,
      // Not a credential, but anyone holding it can fake a successful run.
      type: "secret",
      destinations: [{ kind: "vercel", target: "production" }],
    })
  ),

  // --- GitHub Actions CI credentials (not Vercel/app vars) --------------------------------
  {
    name: "CHECKLY_API_KEY",
    group: "GitHub Actions CI",
    description: "Authenticates `checkly deploy` in CI.",
    type: "secret",
    destinations: [{ kind: "github" }],
  },
  {
    name: "CHECKLY_ACCOUNT_ID",
    group: "GitHub Actions CI",
    description: "Checkly account ID used by CI.",
    type: "config",
    destinations: [{ kind: "github" }],
  },
  {
    name: "SUPABASE_ACCESS_TOKEN",
    group: "GitHub Actions CI",
    description:
      "Authenticates `supabase` CLI calls in CI (migration push, config push).",
    type: "secret",
    destinations: [{ kind: "github" }],
  },
  {
    name: "SUPABASE_DB_PASSWORD",
    group: "GitHub Actions CI",
    description:
      "Production Supabase DB password, used when linking the project in CI.",
    type: "secret",
    destinations: [{ kind: "github" }],
  },
  {
    name: "VERCEL_TOKEN",
    group: "GitHub Actions CI",
    description:
      "Authenticates `vercel pull`/`build`/`deploy` in CI. Must be a normal team-scoped token, NOT project-scoped -- project-scoped tokens can't resolve org/user identity, which `vercel pull` requires (only `vercel deploy` has a fallback for that). Learned the hard way 2026-09-25.",
    type: "secret",
    destinations: [{ kind: "github" }],
  },
  {
    name: "VERCEL_ORG_ID",
    group: "GitHub Actions CI",
    description:
      "Vercel team ID (team_...), used to link the project non-interactively in CI.",
    type: "secret", // an ID, but ci.yml reads it as secrets.* -- keep in sync
    destinations: [{ kind: "github" }],
  },
  {
    name: "VERCEL_PROJECT_ID",
    group: "GitHub Actions CI",
    description:
      "Vercel project ID (prj_...), used to link the project non-interactively in CI.",
    type: "secret", // an ID, but ci.yml reads it as secrets.* -- keep in sync
    destinations: [{ kind: "github" }],
  },
  // SLACK_CONFIG_REFRESH_TOKEN (GitHub secret, also read by the push-slack-manifest job) is
  // deliberately NOT declared here. Slack replaces it every time it's used, so CI rewrites
  // the secret on each run and a copy in .env.prod would be stale after the first one --
  // syncing it would break the job. Seed it by hand; see docs/SLACK_MANIFEST.md.
  {
    name: "GH_TOKEN_SLACK_MANIFEST",
    group: "GitHub Actions CI",
    description:
      "GitHub fine-grained token with Secrets read/write on this repo only. Lets the push-slack-manifest job save the rotated SLACK_CONFIG_REFRESH_TOKEN back to GitHub secrets (the job's own GITHUB_TOKEN can't write secrets).",
    type: "secret",
    destinations: [{ kind: "github" }],
  },
  {
    name: "DOCKERHUB_USERNAME",
    group: "GitHub Actions CI",
    description:
      "Docker Hub username (not the email) CI logs in as before `supabase start`, so image pulls are authenticated: anonymous pulls from shared runner IPs hit Docker Hub's rate limit (\"toomanyrequests\") and fail the db tests, which blocks migrations and deploys. A GitHub variable, not a secret.",
    type: "config",
    destinations: [{ kind: "github" }],
  },
  {
    name: "DOCKERHUB_TOKEN",
    group: "GitHub Actions CI",
    description:
      "Docker Hub access token (Account settings -> Personal access tokens, read-only scope is enough) for DOCKERHUB_USERNAME. Use a token, not the account password.",
    type: "secret",
    destinations: [{ kind: "github" }],
  },

  // --- Email (Resend) ---------------------------------------------------------------------------
  {
    name: "RESEND_API_KEY",
    group: "Email (Resend)",
    description:
      "Resend API key (sending access). The app sends member notification emails with it (lib/email.ts). The same key is Supabase Auth's SMTP password: the config push (`npm run config:push` locally, and CI's push-migrations job on every push to main) reads it via config.toml's env(RESEND_API_KEY), and CI refuses to push config without it, since the push would otherwise overwrite production's SMTP password.",
    type: "secret",
    destinations: [...vercelAllEnvs, { kind: "github" }],
  },
  {
    name: "EMAIL_UNSUBSCRIBE_SECRET",
    group: "Email (Resend)",
    description:
      "Signing secret for the unsubscribe links in notification emails (lib/email-unsubscribe.ts). Changing it breaks the unsubscribe links in emails already sent, so treat it as permanent. Emails aren't sent without it.",
    type: "secret",
    destinations: vercelAllEnvs,
  },
  {
    name: "EMAIL_DEV_ADDRESS",
    group: "Email (Resend)",
    description: "Address that redirected test-mode notification emails go to. Without it, test mode sends nothing.",
    type: "config",
    destinations: vercelAllEnvs,
  },
  {
    name: "EMAIL_TEST_MODE",
    group: "Email (Resend)",
    description: "Overrides default notification-email redirect behavior outside production.",
    type: "config",
    destinations: vercelAllEnvs,
  },
];
