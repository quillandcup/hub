// env-vars.config.ts
//
// Single source of truth for every environment variable this project uses outside of
// local dev (see .env.example for the local .env.local template). Declares, per var:
// whether it's a secret, and which systems it gets synced to.
//
// scripts/sync-to-vercel.ts, scripts/sync-to-github.ts, and scripts/sync-vault-secrets.ts
// all read this file instead of maintaining their own hardcoded var lists -- that
// duplication is what let VERCEL_DEPLOY_HOOK_URL linger as a GitHub secret after it was
// replaced, and let .env.example drift out of sync with what's actually required. Add or
// remove a var here and every sync script picks it up automatically.
//
// `group` is also the canonical section ordering for .env.example/.env.devel/.env.prod --
// those files are grouped and commented to match this array's order and each var's
// `description`, so there's one layout to keep in sync instead of three independent ones.
//
// Values themselves are NOT stored here -- they stay in .env.devel / .env.prod (gitignored
// dotenv files) as before. This file is just the schema: name, secrecy, and destinations.
// SOPS-encrypting .env.devel/.env.prod so they can be committed is a planned follow-up,
// tracked separately -- unrelated to this file, which has nothing sensitive to encrypt.

/** A Vercel environment `vercel env add` can target. */
export type VercelTarget = "development" | "preview" | "production";

export type Destination =
  /**
   * Synced via `vercel env add <name> <target> --type config`. Always `config` type
   * (never `secret`/`sensitive`) regardless of this var's `secret` flag below -- Vercel's
   * "Sensitive" type is write-only and can never be retrieved again, by anyone, including
   * `vercel pull`. Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle at build
   * time, so a Sensitive `NEXT_PUBLIC_*` var silently bakes the literal string
   * "[SENSITIVE]" into every page shipped to browsers -- this happened in production on
   * 2026-09-25 (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/SENTRY_DSN) and broke Supabase access
   * for every visitor. `secret: true` here still matters for docs/GitHub Actions below --
   * just never let it drive Vercel's env type.
   */
  | { readonly kind: "vercel"; readonly target: VercelTarget }
  /** Synced via `gh secret set` (secret) or `gh variable set` (plain), GitHub Actions only. */
  | { readonly kind: "github"; readonly type: "secret" | "variable" }
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
   * True for credentials/keys/tokens that grant access or bypass protections. False for
   * identifiers, channel/account IDs, and values explicitly designed to be public
   * (NEXT_PUBLIC_* by Next.js convention, Sentry DSNs by Sentry's own design). Drives
   * GitHub secret-vs-variable choice; deliberately does NOT drive Vercel env type -- see
   * the `vercel` destination kind's doc comment above.
   */
  readonly secret: boolean;
  readonly destinations: readonly Destination[];
}

const vercelAllEnvs: readonly Destination[] = [
  { kind: "vercel", target: "development" },
  { kind: "vercel", target: "preview" },
  { kind: "vercel", target: "production" },
];

export const ENV_VARS: readonly EnvVarSpec[] = [
  // --- Supabase ------------------------------------------------------------------------------
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    group: "Supabase",
    description: "Supabase project URL. Public by design.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    group: "Supabase",
    description:
      "Supabase anon key. Public by design -- RLS is what protects data, not this key's secrecy.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    group: "Supabase",
    description: "Bypasses RLS. Server-only.",
    secret: true,
    destinations: vercelAllEnvs,
  },

  // --- Zoom ----------------------------------------------------------------------------------
  {
    name: "ZOOM_ACCOUNT_ID",
    group: "Zoom",
    description: "Zoom account identifier.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_CLIENT_ID",
    group: "Zoom",
    description: "Zoom OAuth app client ID.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_CLIENT_SECRET",
    group: "Zoom",
    description: "Zoom OAuth app client secret.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_WEBHOOK_SECRET_TOKEN",
    group: "Zoom",
    description: "Verifies Zoom webhook signatures.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_USER_EMAIL",
    group: "Zoom",
    description: "Zoom account email used for API calls.",
    secret: false,
    destinations: vercelAllEnvs,
  },

  // --- Kajabi --------------------------------------------------------------------------------
  {
    name: "KAJABI_CLIENT_ID",
    group: "Kajabi",
    description: "Kajabi OAuth app client ID.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "KAJABI_CLIENT_SECRET",
    group: "Kajabi",
    description: "Kajabi OAuth app client secret.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "KAJABI_SITE_ID",
    group: "Kajabi",
    description: "Kajabi site identifier.",
    secret: false,
    destinations: vercelAllEnvs,
  },

  // --- Google Calendar -------------------------------------------------------------------------
  {
    name: "GOOGLE_CALENDAR_ID",
    group: "Google Calendar",
    description: "Google Calendar ID synced for events.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "GOOGLE_SERVICE_ACCOUNT_KEY",
    group: "Google Calendar",
    description: "Full Google service account JSON key.",
    secret: true,
    destinations: vercelAllEnvs,
  },

  // --- Google OAuth (per-user consent, e.g. Photos Picker) -----------------------------------
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    group: "Google OAuth",
    description:
      "Google OAuth Web Client ID (per-user consent flows, e.g. Photos Picker).",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_SECRET",
    group: "Google OAuth",
    description: "Google OAuth Web Client secret.",
    secret: true,
    destinations: vercelAllEnvs,
  },

  // --- Slack -----------------------------------------------------------------------------------
  {
    name: "SLACK_BOT_TOKEN",
    group: "Slack",
    description: "Slack bot OAuth token.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_FEEDBACK_CHANNEL_ID",
    group: "Slack",
    description: "Channel ID feedback-widget submissions post to.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_NEW_BOOKS_CHANNEL_ID",
    group: "Slack",
    description: "Channel ID for new-book staff notifications. Optional.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_NEW_AWARDS_CHANNEL_ID",
    group: "Slack",
    description: "Channel ID for new-award staff notifications. Optional.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_DEV_USER_ID",
    group: "Slack",
    description: "Slack member ID that redirected test-mode DMs go to.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_TEST_MODE",
    group: "Slack",
    description: "Overrides default DM-redirect behavior outside production.",
    secret: false,
    destinations: vercelAllEnvs,
  },

  // --- Stripe ----------------------------------------------------------------------------------
  {
    name: "STRIPE_API_KEY",
    group: "Stripe",
    description: "Stripe secret API key.",
    secret: true,
    destinations: vercelAllEnvs,
  },

  // --- Admin & Cron ------------------------------------------------------------------------------
  {
    name: "SUDO_SECRET",
    group: "Admin & Cron",
    description: "Signing secret for the admin sudo cookie.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "CRON_SECRET",
    group: "Admin & Cron",
    description: "Authenticates Vercel's own native cron job requests.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "CRON_INTERNAL_SECRET",
    group: "Admin & Cron",
    description:
      "Authenticates Supabase pg_cron -> internal API route calls via pg_net.",
    secret: true,
    destinations: [
      ...vercelAllEnvs,
      { kind: "vault", vaultName: "writing_nudge_cron_secret" },
    ],
  },

  // --- Analytics & Monitoring ------------------------------------------------------------------
  {
    name: "NEXT_PUBLIC_GA_ID",
    group: "Analytics & Monitoring",
    description: "GA4 measurement ID. Public by design.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SENTRY_DSN",
    group: "Analytics & Monitoring",
    description:
      "Server-side Sentry DSN. DSNs are designed to be safe to expose (write-only ingest endpoint).",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "NEXT_PUBLIC_SENTRY_DSN",
    group: "Analytics & Monitoring",
    description:
      "Client-side Sentry DSN. Public by design, same reasoning as SENTRY_DSN.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SENTRY_AUTH_TOKEN",
    group: "Analytics & Monitoring",
    description:
      "Build-time secret for uploading production source maps. Not needed for dev/preview builds -- production only.",
    secret: true,
    destinations: [{ kind: "vercel", target: "production" }],
  },

  // --- GitHub Actions CI credentials (not Vercel/app vars) --------------------------------
  {
    name: "CHECKLY_API_KEY",
    group: "GitHub Actions CI",
    description: "Authenticates `checkly deploy` in CI.",
    secret: true,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "CHECKLY_ACCOUNT_ID",
    group: "GitHub Actions CI",
    description: "Checkly account ID used by CI.",
    secret: false,
    destinations: [{ kind: "github", type: "variable" }],
  },
  {
    name: "SUPABASE_ACCESS_TOKEN",
    group: "GitHub Actions CI",
    description:
      "Authenticates `supabase` CLI calls in CI (migration push, config push).",
    secret: true,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "SUPABASE_DB_PASSWORD",
    group: "GitHub Actions CI",
    description:
      "Production Supabase DB password, used when linking the project in CI.",
    secret: true,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "VERCEL_TOKEN",
    group: "GitHub Actions CI",
    description:
      "Authenticates `vercel pull`/`build`/`deploy` in CI. Must be a normal team-scoped token, NOT project-scoped -- project-scoped tokens can't resolve org/user identity, which `vercel pull` requires (only `vercel deploy` has a fallback for that). Learned the hard way 2026-09-25.",
    secret: true,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "VERCEL_ORG_ID",
    group: "GitHub Actions CI",
    description:
      "Vercel team ID (team_...), used to link the project non-interactively in CI.",
    secret: false,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "VERCEL_PROJECT_ID",
    group: "GitHub Actions CI",
    description:
      "Vercel project ID (prj_...), used to link the project non-interactively in CI.",
    secret: false,
    destinations: [{ kind: "github", type: "secret" }],
  },

  // --- Ops-only: read directly from .env.prod by local scripts, not synced anywhere -------
  {
    name: "RESEND_API_KEY",
    group: "Ops (local scripts only)",
    description:
      "SMTP auth for Supabase Auth emails. Read by `npm run config:push` (supabase config push) via config.toml's env(RESEND_API_KEY); the app itself never reads it, so it isn't synced to Vercel.",
    secret: true,
    destinations: [],
  },
];
