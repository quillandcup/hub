import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs/config";
import appConfig from "./app.config";
import { buildCsp, CSP_REPORT_ONLY_HEADER } from "./lib/csp";
import { helpImagesVersion } from "./scripts/help-images-version";
import { readSkewMaxAgeSeconds } from "./scripts/skew-protection-config";

// Preview deployments have intermittently hung indefinitely (~45 min, then
// force-errored with no diagnostic output) during Next.js's "checking
// validity of types" build phase -- reproduced across multiple unrelated
// branches/commits/times, never in GitHub Actions CI running the identical
// `pnpm build`. Not correlated with the Sentry auth-token warning (which
// is benign and unrelated -- see next.config's Sentry options below). Root
// cause unconfirmed (a Vercel build-machine resource stall was suspected,
// but the account is on Pro, not Hobby, so that specific explanation
// doesn't clearly hold -- treat this as a verified-effective workaround for
// an unexplained stall, not a diagnosed fix). GitHub Actions CI already
// runs the full `pnpm build` (typecheck) on every PR and push to main,
// so skip that same, resource-heavy pass on preview builds specifically to
// remove the hang risk; production builds keep full enforcement as a second
// safety net.
//
// Next.js 16 removed the `eslint` build option entirely (`next build` no
// longer lints at all, regardless of config) -- linting now only happens
// via the explicit `pnpm lint` step in CI.
const isPreview = process.env.VERCEL_ENV === "preview";

const nextConfig: NextConfig = {
  // Pairs this build with the help screenshot set captured from the same source (scripts/help-images-version.ts).
  // Derived from git at build time, not configuration: "local" outside CI.
  env: {
    HELP_IMAGES_VERSION: helpImagesVersion(),
    // When this build was made, and how long Vercel keeps serving a deployment to the tabs opened on it (vercel-project-config.yml,
    // applied by scripts/vercel-config.ts): the page can tell when its own deployment is about to stop being served (lib/skew-deadline.ts).
    BUILD_TIME: new Date().toISOString(),
    SKEW_PROTECTION_MAX_AGE_SECONDS: String(readSkewMaxAgeSeconds()),
  },
  outputFileTracingRoot: path.join(__dirname),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typescript: {
    ignoreBuildErrors: isPreview,
  },
  // Revisiting a page within 30s reuses what the client already has (default 0: every click renders on
  // the server). Makes flipping between chat conversations instant; a server action that calls
  // revalidatePath still clears it, and the live conversation reconciles over Realtime.
  experimental: { staleTimes: { dynamic: 30 } },
  // Report-Only Content-Security-Policy on every response (lib/csp.ts): reports what it would block, blocks nothing.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: CSP_REPORT_ONLY_HEADER,
            value: buildCsp({
              supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
              imageHosts: appConfig.csp.imageHosts,
              sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
            }),
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Only used for the source map upload. Slugs from app.config.ts; the auth token is a
  // GitHub secret passed to CI's production `vercel build` (see env-vars.config.ts).
  org: appConfig.sentry.org,
  project: appConfig.sentry.project,

  // Source map upload auth token (build-time secret, generated at
  // sentry.io/settings/account/api/auth-tokens) for readable production stack
  // traces. Builds succeed without it; source maps just won't upload. Only the
  // CI production build has it, so skip the upload attempt entirely elsewhere
  // instead of accepting the "No auth token provided" warning noise every build.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  // Upload a wider set of client source files for better stack trace resolution.
  widenClientFileUpload: true,

  // Route Sentry client requests through our own domain to bypass ad-blockers.
  tunnelRoute: "/monitoring",

  // Suppress non-CI build output noise.
  silent: !process.env.CI,
});
