// app.config.ts
//
// Organization settings that are the same in every environment (local, preview, production).
// Values that differ per environment, and all secrets, are env vars instead -- see
// env-vars.config.ts. Nothing else in the code should hardcode these.
//
// Read by lib/config.ts (app code), next.config.ts, __checks__/config.ts (Checkly), and
// scripts. SQL can't import this file: `pnpm env:sync:vault` copies the values pg_cron
// needs into Supabase Vault (SHARED_CONFIG_IN_VAULT in scripts/sync-vault-secrets.ts) -- re-run
// it after changing one of those.

export const appConfig = {
  /** The app's name as shown when installed to a home screen (the web app manifest). */
  appName: "Quill & Cup Hub",

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

  /**
   * How long after writing a staff note its author can still correct it (minutes), for typos and
   * quick rewrites. The Hub passes it to the database function that does the edit
   * (`edit_member_admin_note`), which SQL can't read from here. The timeline shows "edited".
   */
  adminNoteEditMinutes: 15,

  /** Support address shown to members (settings, /no-access, the auth email footer). */
  supportEmail: "support@quillandcup.com",

  /**
   * Sender of member notification emails (lib/email.ts). The domain must be verified in Resend.
   * Supabase Auth emails use the same address, declared separately in supabase/config.toml
   * (`[remotes.prod.auth.email.smtp]`), which can't read this file.
   */
  email: { fromName: "Hedgie Hub", fromAddress: "no-reply@hub.quillandcup.com" },

  /**
   * The Slack workspace: its URL (for links that open a channel) and the channel new members
   * introduce themselves in. The Getting started tour and its reminders look for a member's
   * top-level message there.
   */
  slack: {
    workspaceUrl: "https://quillandcup.slack.com",
    introChannel: "start-here",
    /** Production operations alerts for failed notification DMs and ambiguous member matches. */
    alertsChannelId: "C0CA91G8LGH", // #hub-alerts
    /** The same channel by name, for the Checkly Slack app (__checks__/alert-channels.ts), which takes names. */
    alertsChannelName: "#hub-alerts",
    /**
     * Where the weekly "What's new" digest is also posted (#announcements, open to all members): an excerpt of the
     * new changelog entries with a link to /changelog. Leave empty to post nowhere.
     */
    changelogChannelId: "C01PGFFQGQ0",
  },

  /**
   * The first day (YYYY-MM-DD, Eastern) a changelog entry can go out in the weekly digest and the announcements post.
   * Entries dated before it (the backfilled history) are on the What's new page and the admin Changelog but are never
   * notified, so turning the digest on does not send members the past.
   */
  changelogDigestStartsOn: "2026-11-04",

  /**
   * First day we have prickle attendance for (YYYY-MM-DD). A member who joined before it may have
   * attended plenty that we can't see, so reminders never call a prickle their "first".
   */
  attendanceDataStartsOn: "2026-01-01",

  /**
   * Whether the Bookshelf is open to people who aren't signed in. While false, a book's cover is readable by
   * signed-in members only. When true, the shelf-size version of any image a book uses as its cover is served
   * to everyone (app/api/media/[id]/[preset]/route.ts); it does not make the Bookshelf page public, which is a
   * change to that page and to who may reach it.
   */
  bookshelfPublic: false,

  /**
   * The course the Courses page offers to a member who has none: its name, and the public waitlist
   * page where members sign up for it.
   */
  featuredCourse: { title: "The Ready Writer", offerUrl: "https://www.quillandcup.com/waitlist" },

  /**
   * Sentry org/project slugs for the production build's source map upload, and the regional API host the org's
   * settings are read and written on (sentry-config.yml, scripts/sentry-config.ts). The org is in the EU region.
   */
  sentry: { org: "quillandcup", project: "hub", apiUrl: "https://de.sentry.io" },

  /**
   * Content-Security-Policy (lib/csp.ts, sent by next.config.ts, today as Report-Only): the origins other than our own
   * and Supabase storage that pictures may load from. Member photos, book covers and Slack link previews can come from
   * anywhere, so the reports will name hosts missing here; Slack app pictures go through our own proxy
   * (/api/chat/unfurl-image) and need nothing listed.
   */
  /**
   * Hosts where Kajabi keeps member photos (the Kajabi CDN, going away when Kajabi is retired). `pnpm photos:adopt`
   * copies the photos found there into our own storage (lib/members/adopt-photos.ts). Names only, no scheme.
   */
  kajabiPhotoHosts: ["kajabi-storefronts-production.kajabi-cdn.com"],

  csp: {
    imageHosts: [
      "https://image.mux.com", // lesson video stills
      "https://www.gravatar.com", // avatars by email
      "https://secure.gravatar.com",
      "https://kajabi-storefronts-production.kajabi-cdn.com", // photos and covers imported from Kajabi
      "https://avatars.slack-edge.com", // Slack profile photos
      "https://*.googleusercontent.com", // Google profile photos
      "https://www.google-analytics.com", // measurement beacons
      "https://www.googletagmanager.com",
    ],
  },
} as const;

export default appConfig;
