/**
 * Environment Configuration
 *
 * Centralized configuration for environment-aware behavior.
 * Automatically detects the current environment (local, preview, production)
 * based on Vercel system environment variables.
 */

/**
 * Environment type
 */
export type Environment = 'development' | 'preview' | 'production';

/**
 * Current environment
 * - 'production': Production deployment (main branch, custom domain)
 * - 'preview': Preview deployment (feature branches, PR previews)
 * - 'development': Local development (npm run dev)
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
 * Organization/deployment settings (declared in env-vars.config.ts). No defaults: a missing var
 * throws when this module loads, so a misconfigured build or server fails fast instead of
 * quietly using a value baked into the code.
 *
 * NEXT_PUBLIC_* names must be written out literally (`process.env.NEXT_PUBLIC_X`), not looked
 * up by a variable key: Next.js inlines them into client bundles by matching that exact text.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set -- see env-vars.config.ts`);
  return value;
}

/**
 * The organization's home timezone (IANA name): org-wide calendars, streak/day boundaries,
 * default schedule timezone, and the fallback when a member has no preference. Stored
 * commitment slots are in this timezone, so changing it needs a data migration.
 */
export const ORG_TIMEZONE = required("NEXT_PUBLIC_ORG_TIMEZONE", process.env.NEXT_PUBLIC_ORG_TIMEZONE);

/** Where members are told to email for help. */
export const SUPPORT_EMAIL = required("NEXT_PUBLIC_SUPPORT_EMAIL", process.env.NEXT_PUBLIC_SUPPORT_EMAIL);

/** Canonical base URL of this deployment, no trailing slash (links in Slack messages, iCal UIDs). */
export const APP_URL = required("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, "");

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
