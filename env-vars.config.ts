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
  // --- App runtime vars (Vercel development + preview + production) -----------------------
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    description: "Supabase project URL. Public by design.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    description:
      "Supabase anon key. Public by design -- RLS is what protects data, not this key's secrecy.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    description: "Bypasses RLS. Server-only.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_ACCOUNT_ID",
    description: "Zoom account identifier.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_CLIENT_ID",
    description: "Zoom OAuth app client ID.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_CLIENT_SECRET",
    description: "Zoom OAuth app client secret.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_WEBHOOK_SECRET_TOKEN",
    description: "Verifies Zoom webhook signatures.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "ZOOM_USER_EMAIL",
    description: "Zoom account email used for API calls.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "KAJABI_CLIENT_ID",
    description: "Kajabi OAuth app client ID.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "KAJABI_CLIENT_SECRET",
    description: "Kajabi OAuth app client secret.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "KAJABI_SITE_ID",
    description: "Kajabi site identifier.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "GOOGLE_CALENDAR_ID",
    description: "Google Calendar ID synced for events.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "GOOGLE_SERVICE_ACCOUNT_KEY",
    description: "Full Google service account JSON key.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    description:
      "Google OAuth Web Client ID (per-user consent flows, e.g. Photos Picker).",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_SECRET",
    description: "Google OAuth Web Client secret.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_BOT_TOKEN",
    description: "Slack bot OAuth token.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_FEEDBACK_CHANNEL_ID",
    description: "Channel ID feedback-widget submissions post to.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_NEW_BOOKS_CHANNEL_ID",
    description: "Channel ID for new-book staff notifications. Optional.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_NEW_AWARDS_CHANNEL_ID",
    description: "Channel ID for new-award staff notifications. Optional.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_DEV_USER_ID",
    description: "Slack member ID that redirected test-mode DMs go to.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SLACK_TEST_MODE",
    description: "Overrides default DM-redirect behavior outside production.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "STRIPE_API_KEY",
    description: "Stripe secret API key.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "SUDO_SECRET",
    description: "Signing secret for the admin sudo cookie.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "CRON_SECRET",
    description: "Authenticates Vercel's own native cron job requests.",
    secret: true,
    destinations: vercelAllEnvs,
  },
  {
    name: "CRON_INTERNAL_SECRET",
    description:
      "Authenticates Supabase pg_cron -> internal API route calls via pg_net.",
    secret: true,
    destinations: [
      ...vercelAllEnvs,
      { kind: "vault", vaultName: "writing_nudge_cron_secret" },
    ],
  },
  {
    name: "NEXT_PUBLIC_GA_ID",
    description: "GA4 measurement ID. Public by design.",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "SENTRY_DSN",
    description:
      "Server-side Sentry DSN. DSNs are designed to be safe to expose (write-only ingest endpoint).",
    secret: false,
    destinations: vercelAllEnvs,
  },
  {
    name: "NEXT_PUBLIC_SENTRY_DSN",
    description:
      "Client-side Sentry DSN. Public by design, same reasoning as SENTRY_DSN.",
    secret: false,
    destinations: vercelAllEnvs,
  },

  // --- App runtime, production only ---------------------------------------------------------
  {
    name: "SENTRY_AUTH_TOKEN",
    description:
      "Build-time secret for uploading production source maps. Not needed for dev/preview builds.",
    secret: true,
    destinations: [{ kind: "vercel", target: "production" }],
  },

  // --- GitHub Actions CI credentials (not Vercel/app vars) --------------------------------
  {
    name: "CHECKLY_API_KEY",
    description: "Authenticates `checkly deploy` in CI.",
    secret: true,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "CHECKLY_ACCOUNT_ID",
    description: "Checkly account ID used by CI.",
    secret: false,
    destinations: [{ kind: "github", type: "variable" }],
  },
  {
    name: "SUPABASE_ACCESS_TOKEN",
    description:
      "Authenticates `supabase` CLI calls in CI (migration push, config push).",
    secret: true,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "SUPABASE_DB_PASSWORD",
    description:
      "Production Supabase DB password, used when linking the project in CI.",
    secret: true,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "VERCEL_TOKEN",
    description:
      "Authenticates `vercel pull`/`build`/`deploy` in CI. Must be a normal team-scoped token, NOT project-scoped -- project-scoped tokens can't resolve org/user identity, which `vercel pull` requires (only `vercel deploy` has a fallback for that). Learned the hard way 2026-09-25.",
    secret: true,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "VERCEL_ORG_ID",
    description:
      "Vercel team ID (team_...), used to link the project non-interactively in CI.",
    secret: false,
    destinations: [{ kind: "github", type: "secret" }],
  },
  {
    name: "VERCEL_PROJECT_ID",
    description:
      "Vercel project ID (prj_...), used to link the project non-interactively in CI.",
    secret: false,
    destinations: [{ kind: "github", type: "secret" }],
  },

  // --- Ops-only: read directly from .env.prod by local scripts, not synced anywhere -------
  {
    name: "RESEND_API_KEY",
    description:
      "SMTP auth for Supabase Auth emails. Read by `npm run config:push` (supabase config push) via config.toml's env(RESEND_API_KEY); the app itself never reads it, so it isn't synced to Vercel.",
    secret: true,
    destinations: [],
  },
];
