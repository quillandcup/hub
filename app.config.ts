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
  /** The app's name as shown when installed to a home screen (the web app manifest, the iOS title). */
  appName: "Hedgie Hub",

  /**
   * The issuer on the two-step sign-in QR code: authenticator apps show it beside the account, and Authy searches
   * Google Images for a logo from it (components/mfa/MfaPanel.tsx). The bare domain brings up our own logo, though a
   * blurry copy (tried in Authy: "Hedgie Hub" gave LEGO, "Quill & Cup Hedgie Hub" a stock hedgehog, "Quill & Cup" a
   * small wordmark). A sharper result needs Google to rank a better copy of the logo: docs/TODO.md, "Sharper logo in
   * authenticator apps". Re-test before changing it.
   */
  mfaIssuer: "quillandcup.com",

  /**
   * The product token in the User-Agent every outbound request sends (lib/config.ts `OUTBOUND_USER_AGENT`,
   * docs/OUTBOUND_REQUESTS.md). An HTTP token: letters, digits and `-._` only, no spaces, so it is not `appName`.
   */
  userAgentProduct: "HedgieHub",

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

  /**
   * When staff (admins and community managers) must sign in with a second step (a TOTP code from an authenticator app,
   * lib/staff-mfa.ts, docs/STAFF_MFA.md). `null` = not required yet: staff without it see a banner that points them to
   * Settings, and staff who have set it up are still asked for the code. To require it for everyone, set an ISO 8601
   * instant with an offset, for example "2027-02-01T00:00:00-05:00"; from then on staff without it are sent to the
   * set-up screen instead of the admin area. Set it a week or two ahead, after every admin has enrolled. A value that
   * doesn't parse counts as off (tests/lib/staff-mfa.test.ts fails on one).
   */
  staffMfaRequiredFrom: null as string | null,

  /**
   * Hedgie Care (the community manager's reach-outs, lib/care.ts, docs/HEDGIE_CARE.md). These are starting points
   * for her to confirm, not settled numbers; change them here, never in code.
   *
   * `careEngagementDays`: how long one engagement (one reach-out period) lasts. The period ends on the org-timezone
   * calendar day this many days after it opened.
   * `careLapseGraceDays`: days after the period ends during which it waits for her to renew or close it ("Review
   * due"); after that, an engagement nobody answered for moves to "Earlier" as lapsed.
   * `careQuietDays`: days with nothing from either side before "waiting on them" becomes "gone quiet".
   * `careBeforeDays`, `careAfterFromDays`, `careAfterToDays`: the measured windows. Before is this many days before it
   * opened; after is from `careAfterFromDays` to `careAfterToDays` days after the period ended.
   * `careRetentionCheckpointDays`: the days after the period's last day at which the results say whether the member was
   * active, on hiatus or cancelled (the graded retention view). Starting points for the owner to confirm.
   */
  careEngagementDays: 30,
  careLapseGraceDays: 14,
  careQuietDays: 14,
  careBeforeDays: 28,
  careAfterFromDays: 30,
  careAfterToDays: 60,
  careRetentionCheckpointDays: [60, 90, 180],

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
    /** Where wins are cheered (#hedgiehype, open to all members): new books and awards. */
    celebrationsChannelId: "C02L0FEFVGQ",
    /** Move one kind of celebration to its own channel (kind -> channel id); kinds not listed use celebrationsChannelId. Kinds: book, award. */
    celebrationChannelOverrides: {} as Record<string, string>,
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
   * settings are read and written on (config/sentry.yml, scripts/sentry-config.ts). The org is in the EU region.
   */
  sentry: { org: "quillandcup", project: "hub", apiUrl: "https://de.sentry.io" },

  /**
   * The daily check that the nonce-based Content-Security-Policy is not breaking browsers
   * (app/api/internal/csp-health, lib/csp-health.ts, docs/CSP_ALERTS.md). Measured 2026-11-20 on production over 30
   * days: no member loaded pages without running our scripts (0 of 91 active), about 13 of 91 never get the Google
   * cookie in any browser (steady), and every browser was far above the minimums below.
   * - `windowHours`, `historyDays`: the window checked, and how far back a member's own `_ga` history reaches.
   * - `strandedUsers`: alert when at least `minUsers` (or `minShare` of the active users, if more) loaded pages
   *   but never ran our scripts.
   * - `lostGoogleCookie`: members with at least `minPageViews` page views in the window and the cookie on none,
   *   though it was on some earlier page view in the history. Alert at `minUsers` of them and `minShare` of the
   *   members who had it before.
   * - `minBrowserVersions`: what nonces plus 'strict-dynamic' need ("15.4" is major.minor). `ios` applies to every
   *   browser on an iPhone or iPad, since they all run WebKit and the iOS version decides.
   */
  cspHealth: {
    windowHours: 24,
    historyDays: 30,
    strandedUsers: { minUsers: 2, minShare: 0.05 },
    lostGoogleCookie: { minPageViews: 3, minUsers: 4, minShare: 0.25 },
    minBrowserVersions: { chrome: "52", chromium: "52", edge: "79", firefox: "52", safari: "15.4", ios: "15.4" },
  },

  /**
   * OpenSSF Scorecard (.github/workflows/scorecard.yml): the lowest published score (0 to 10) before the weekly
   * run fails and posts to the alerts channel. Set a little under the score at the time, so ordinary noise does not
   * alert, and raise it in a pull request when the score improves (a ratchet). Measured 2026-11-20: 4.8.
   */
  scorecard: { minScore: 4 },

  /**
   * Content-Security-Policy (lib/csp.ts, sent by next.config.ts, enforcing): the origins other than our own
   * and Supabase storage that pictures may load from. Member photos, book covers and Slack link previews can come from
   * anywhere, so the reports will name hosts missing here; Slack app pictures go through our own proxy
   * (/api/chat/unfurl-image) and need nothing listed.
   */
  /**
   * Hosts where Kajabi keeps member photos (the Kajabi CDN, going away when Kajabi is retired). `pnpm photos:adopt`
   * copies the photos found there into our own storage (lib/members/adopt-photos.ts). Names only, no scheme.
   */
  kajabiPhotoHosts: ["kajabi-storefronts-production.kajabi-cdn.com"],

  /**
   * The public address of the Kajabi site, where its landing pages live today. A link in an imported page that is a
   * Kajabi path (`/resource_redirect/...`) is resolved against it (lib/landing/kajabi-import.ts); retire it with Kajabi.
   */
  kajabiSiteUrl: "https://www.quillandcup.com",

  /** The public site members arrive from, no trailing slash: where the footer of a writer's public page links to. */
  siteUrl: "https://www.quillandcup.com",

  /**
   * Writers' public pages (lib/writer-profile.ts, docs/WRITER_PROFILES.md), at `/w/<handle>`.
   * `handleMinLength`, `handleMaxLength`: the length of a handle (letters, digits and single hyphens).
   * `handleReservationDays`: how long a handle a member gave up stays theirs alone; until then nobody else can take it, and
   * its old address redirects to the new one until someone takes it afterwards.
   * `bioMaxLength`: characters in the bio on the page.
   * `sitemapPageSize`: addresses in one sitemap file (the limit is 50,000).
   * `unpublishablePhotoHosts`: where a profile photo can come from but is never put on a public page. Gravatar's address
   * carries a hash of the member's email.
   * `reservedHandles`: handles nobody can choose, so a page cannot pass for the community, its staff or a place in the app.
   * Compared with hyphens left out, so "quill-and-cup" is held by "quillandcup".
   */
  writerProfiles: {
    handleMinLength: 3,
    handleMaxLength: 30,
    handleReservationDays: 90,
    bioMaxLength: 1000,
    sitemapPageSize: 10000,
    unpublishablePhotoHosts: ["gravatar.com", "www.gravatar.com", "secure.gravatar.com"],
    reservedHandles: [
      // The community and the product.
      "quillandcup", "quill", "cup", "qandc", "hedgie", "hedgies", "hedgiehub", "hedgiecare", "billie", "billiebot", "hub",
      // People who run it, and words that sound official.
      "staff", "team", "admin", "admins", "administrator", "moderator", "mod", "mods", "owner", "owners", "founder", "founders",
      "official", "support", "help", "helpdesk", "contact", "info", "press", "security", "privacy", "legal", "abuse",
      "postmaster", "webmaster", "hello", "careers", "jobs", "sales", "billing", "payments",
      // Places in the app and on the site.
      "api", "app", "auth", "login", "logout", "signin", "signup", "register", "account", "accounts", "settings", "profile",
      "profiles", "member", "members", "writer", "writers", "author", "authors", "finisher", "finishers", "dashboard", "home",
      "about", "blog", "news", "courses", "course", "lessons", "lesson", "events", "event", "prickle", "prickles", "chat",
      "calendar", "books", "bookshelf", "projects", "goals", "awards", "badges", "compliance", "terms", "unsubscribe",
      "verify", "sitemap", "robots", "static", "assets", "public", "images", "media", "download", "downloads", "www", "mail",
      "email", "ftp", "cdn", "status", "docs", "wiki", "search", "explore", "feed", "new", "edit", "delete",
      // Words that read as nobody or as the system.
      "null", "undefined", "root", "system", "test", "demo", "example", "anonymous", "everyone", "all",
    ],
  },

  /** An offer's edit page in the Kajabi admin, for the admin Offers page; `{offerId}` is filled in. */
  kajabiAdminOfferUrl: "https://app.kajabi.com/admin/offers/{offerId}/edit",

  /**
   * The Claude API, used only by "Build with AI" on the landing page builder (lib/landing/ai.ts): the admin's own
   * description of a page goes in, a draft comes out. Nothing a member wrote is ever sent (docs/LANDING_PAGES.md).
   */
  anthropic: { apiUrl: "https://api.anthropic.com", apiVersion: "2023-06-01", landingPageModel: "claude-sonnet-5-5" },

  csp: {
    imageHosts: [
      "https://image.mux.com", // lesson video stills
      "https://www.gravatar.com", // avatars by email
      "https://secure.gravatar.com",
      "https://kajabi-storefronts-production.kajabi-cdn.com", // photos and covers imported from Kajabi
      "https://kajabi-storefronts-production.s3.amazonaws.com", // course thumbnails imported from Kajabi (seen on /courses)
      "https://avatars.slack-edge.com", // Slack profile photos
      "https://a.slack-edge.com", // one Slack user picture lives here
      "https://*.googleusercontent.com", // Google profile photos
      "https://www.google-analytics.com", // measurement beacons
      "https://*.google-analytics.com", // the EU collection host (region1.google-analytics.com); Google's CSP guide lists the wildcard for img-src
      "https://www.googletagmanager.com",
    ],
    // The next three are tried report-only (docs/TODO.md, "CSP for scripts and styles"): the reports name what is missing.
    // Supabase (https and wss) and Sentry's ingest host are added from the environment, not listed here.
    /** Where the browser may send requests (fetch, XHR, WebSocket) besides us. */
    connectHosts: [
      "https://www.google-analytics.com",
      "https://*.google-analytics.com",
      "https://*.analytics.google.com",
      "https://www.googletagmanager.com",
      "https://vitals.vercel-insights.com", // Vercel Speed Insights
      "https://stream.mux.com", // lesson video playback
      "https://*.mux.com", // the player fetches HLS manifests and chunks from CDN hosts (*.fastly.mux.com, *.edgemv.mux.com)
      "https://*.litix.io", // Mux video analytics
      // Google Analytics also sends its page_view beacon to www.google.com/g/collect (HUB-1Y). Pinned to that path: Google's
      // own guide allows all of *.google.com, which would let a script on our pages talk to any endpoint on that host.
      "https://www.google.com/g/collect",
    ],
    /** Sites that may be shown in a frame on our pages (lesson videos). */
    frameHosts: ["https://player.mux.com", "https://www.youtube-nocookie.com", "https://www.youtube.com", "https://player.vimeo.com"],
    /** Where audio and video files may load from besides us and Supabase storage. */
    mediaHosts: ["https://stream.mux.com", "https://image.mux.com"],
  },
} as const;

export default appConfig;
