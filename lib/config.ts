/**
 * Environment Configuration
 *
 * Centralized configuration for environment-aware behavior.
 * Automatically detects the current environment (local, preview, production)
 * based on Vercel system environment variables.
 */

// Relative, not "@/": also loaded outside Next (scripts/render-email-templates.ts via
// supabase/emails/layout.tsx).
import appConfig from "../app.config";

/**
 * Environment type
 */
export type Environment = 'development' | 'preview' | 'production';

/**
 * Current environment
 * - 'production': Production deployment (main branch, custom domain)
 * - 'preview': Preview deployment (feature branches, PR previews)
 * - 'development': Local development (pnpm dev)
 */
export const environment: Environment =
  (process.env.VERCEL_ENV as Environment) || 'development';

/**
 * Environment checks
 */
export const isProduction = environment === 'production';
export const isPreview = environment === 'preview';
export const isDevelopment = environment === 'development';

/**
 * Deployment information (available in Vercel deployments)
 */
export const deployment = {
  url: process.env.VERCEL_URL,
  branchUrl: process.env.VERCEL_BRANCH_URL,
  commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
  branch: process.env.VERCEL_GIT_COMMIT_REF,
};

/**
 * Organization settings shared by every environment, from app.config.ts at the repo root.
 * Per-environment values and secrets are env vars (env-vars.config.ts) instead.
 */

/**
 * The organization's home timezone (IANA name): org-wide calendars, streak/day boundaries,
 * default schedule timezone, and the fallback when a member has no preference. Stored
 * commitment slots are in this timezone, so changing it needs a data migration.
 */
export const ORG_TIMEZONE = appConfig.orgTimezone;

/** Minutes after writing a staff note during which its author can edit it (app.config.ts `adminNoteEditMinutes`). */
export const ADMIN_NOTE_EDIT_MINUTES: number = appConfig.adminNoteEditMinutes;

/** Where members are told to email for help. */
export const SUPPORT_EMAIL = appConfig.supportEmail;

/** Whether book covers are served to visitors who aren't signed in (app.config.ts `bookshelfPublic`). */
export const BOOKSHELF_PUBLIC: boolean = appConfig.bookshelfPublic;

/** Slack workspace URL, no trailing slash, for links that open a channel. */
export const SLACK_WORKSPACE_URL = appConfig.slack.workspaceUrl.replace(/\/+$/, "");

/** Name of the Slack channel new members introduce themselves in. */
export const SLACK_INTRO_CHANNEL = appConfig.slack.introChannel;

/** Channel for production operations alerts posted by Billie Bot. */
export const SLACK_ALERTS_CHANNEL_ID = appConfig.slack.alertsChannelId;

/** Channel the weekly changelog digest is posted to, or "" for none (app.config.ts `slack.changelogChannelId`). */
export const SLACK_CHANGELOG_CHANNEL_ID: string = appConfig.slack.changelogChannelId;

/** First day (YYYY-MM-DD) a changelog entry can be notified in the digest or the channel post (app.config.ts `changelogDigestStartsOn`). */
export const CHANGELOG_DIGEST_STARTS_ON: string = appConfig.changelogDigestStartsOn;

/** First day (YYYY-MM-DD) prickle attendance is recorded from. */
/** Hosts where Kajabi keeps member photos; the adoption script copies those into our storage. */
export const KAJABI_PHOTO_HOSTS: readonly string[] = appConfig.kajabiPhotoHosts;

export const ATTENDANCE_DATA_STARTS_ON = appConfig.attendanceDataStartsOn;

/** The course the Courses page offers to members who have none, and its waitlist page (app.config.ts `featuredCourse`). */
export const FEATURED_COURSE = appConfig.featuredCourse;

/** The `From` of notification emails: `Name <address>`. */
export const EMAIL_FROM = `${appConfig.email.fromName} <${appConfig.email.fromAddress}>`;

/**
 * Canonical (production) base URL, no trailing slash, the same in every environment: links in
 * Slack messages and iCal event UIDs, which must stay stable or calendar subscribers see
 * duplicates. Links that should follow the serving deployment use the request's origin.
 */
export const APP_URL = appConfig.appUrl.replace(/\/+$/, "");

/**
 * The User-Agent of every request this app makes to a server that is not ours (docs/OUTBOUND_REQUESTS.md).
 * RFC 9110 form: `product/version (comment)`. Wikimedia and others refuse requests with none, and ask for a
 * name and a way to reach us. Carries nothing about a member. The pieces come from app.config.ts and the
 * deployed commit (`deployment.commitSha`, not package.json's version), `dev` when there is none.
 */
const TOKEN_CHARS = /[^A-Za-z0-9!#$%&'*+.^_`|~-]/g;

/** A string reduced to an RFC 9110 `token`: other characters become `-`, never empty. */
export function uaToken(value: string): string {
  return value.replace(TOKEN_CHARS, "-").replace(/^-+|-+$/g, "") || "x";
}

/** Text for the parenthesised comment: printable ASCII without parentheses or a backslash, trimmed to `max`. */
export function uaComment(value: string, max = 200): string {
  return value.replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "").trim().slice(0, max);
}

export function buildUserAgent(parts: { product: string; version?: string; url: string; contact: string }): string {
  const version = uaToken(parts.version || "dev").slice(0, 40);
  return `${uaToken(parts.product)}/${version} (${uaComment(`+${parts.url}; ${parts.contact}`)})`;
}

/** Our product token and version, for SDKs that take the two parts (Slack's `addAppMetadata`, Stripe's `appInfo`). */
export const OUTBOUND_PRODUCT = {
  name: uaToken(appConfig.userAgentProduct),
  version: uaToken(deployment.commitSha?.slice(0, 7) || "dev").slice(0, 40),
};

/** The comment part of the User-Agent, for SDKs that build the string from directives (googleapis). */
export const OUTBOUND_COMMENT = uaComment(`+${APP_URL}; ${SUPPORT_EMAIL}`);

export const OUTBOUND_USER_AGENT = buildUserAgent({
  product: OUTBOUND_PRODUCT.name,
  version: OUTBOUND_PRODUCT.version,
  url: APP_URL,
  contact: SUPPORT_EMAIL,
});

/**
 * The User-Agent with extra product tokens in front of the comment, to say which integration or purpose a
 * request is for (`userAgentWith("slack-import/1")` gives `HedgieHub/abc1234 slack-import/1 (+url; contact)`).
 * Each token is `name` or `name/version`; anything not allowed in an HTTP token becomes `-`.
 */
export function userAgentWith(...tokens: string[]): string {
  const extra = tokens
    .filter(Boolean)
    .map((t) => t.split("/").slice(0, 2).map(uaToken).join("/"));
  const i = OUTBOUND_USER_AGENT.indexOf(" (");
  return [OUTBOUND_USER_AGENT.slice(0, i), ...extra].join(" ") + OUTBOUND_USER_AGENT.slice(i);
}

/**
 * Supabase configuration
 */
export const supabase = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

/**
 * External integrations configuration
 */
export const integrations = {
  zoom: {
    accountId: process.env.ZOOM_ACCOUNT_ID,
    clientId: process.env.ZOOM_CLIENT_ID,
    clientSecret: process.env.ZOOM_CLIENT_SECRET,
  },
  google: {
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  },
  kajabi: {
    clientId: process.env.KAJABI_CLIENT_ID,
    clientSecret: process.env.KAJABI_CLIENT_SECRET,
    siteId: process.env.KAJABI_SITE_ID,
  },
};

/**
 * Feature flags based on environment
 */
export const features = {
  // Enable debug logging in non-production environments
  debugMode: !isProduction,

  // Enable analytics only in production
  analytics: isProduction,

  // Show environment indicator in UI (helpful for distinguishing environments)
  showEnvironmentBadge: !isProduction,

  // Enable stricter error reporting in development
  verboseErrors: isDevelopment,
};

/**
 * Validate required environment variables
 * Throws error if critical variables are missing
 */
export function validateEnvironment() {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please check your .env.local file or Vercel environment settings.\n` +
      `See docs/DEPLOYMENT_SETUP.md for setup instructions.`
    );
  }
}

/**
 * Get environment-friendly display name
 */
export function getEnvironmentName(): string {
  switch (environment) {
    case 'production':
      return 'Production';
    case 'preview':
      return 'Preview';
    case 'development':
      return 'Development';
    default:
      return 'Unknown';
  }
}

/**
 * Get environment color for UI badges
 */
export function getEnvironmentColor(): string {
  switch (environment) {
    case 'production':
      return 'bg-green-500';
    case 'preview':
      return 'bg-yellow-500';
    case 'development':
      return 'bg-blue-500';
    default:
      return 'bg-gray-500';
  }
}

/**
 * Configuration object for easy access
 */
export const config = {
  environment,
  isProduction,
  isPreview,
  isDevelopment,
  deployment,
  supabase,
  integrations,
  features,
  validate: validateEnvironment,
  getEnvironmentName,
  getEnvironmentColor,
} as const;

export default config;
