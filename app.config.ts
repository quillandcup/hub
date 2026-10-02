// app.config.ts
//
// Organization settings that are the same in every environment (local, preview, production).
// Values that differ per environment, and all secrets, are env vars instead -- see
// env-vars.config.ts. Nothing else in the code should hardcode these.
//
// Read by lib/config.ts (app code), next.config.ts, __checks__/config.ts (Checkly), and
// scripts. SQL can't import this file: `npm run env:sync:vault` copies the values pg_cron
// needs into Supabase Vault (SHARED_CONFIG_IN_VAULT in scripts/sync-vault-secrets.ts) -- re-run
// it after changing one of those.

export const appConfig = {
  /**
   * Canonical production URL, no trailing slash. Used for links in Slack messages, iCal event
   * UIDs (changing the host makes every calendar subscriber see duplicate events), the
   * Checkly monitors' target, and pg_cron's calls (via Vault `app_url`).
   */
  appUrl: "https://hub.quillandcup.com",

  /**
   * Organization home timezone (IANA name): org calendars, streak/day boundaries, the default
   * schedule timezone, and the fallback when a member has no preference. Stored commitment
   * slots are in this timezone, so changing it needs a data migration.
   */
  orgTimezone: "America/New_York",

  /** Support address shown to members (settings, /no-access, the auth email footer). */
  supportEmail: "support@quillandcup.com",

  /** Sentry org/project slugs for the production build's source map upload. */
  sentry: { org: "quillandcup", project: "hub" },

  checkly: {
    /** Where Checkly sends monitor alerts. */
    alertEmail: "cody@quillandcup.com",
  },
} as const;

export default appConfig;
