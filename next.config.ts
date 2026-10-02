import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs/config";

// Preview deployments have intermittently hung indefinitely (~45 min, then
// force-errored with no diagnostic output) during Next.js's "checking
// validity of types" build phase -- reproduced across multiple unrelated
// branches/commits/times, never in GitHub Actions CI running the identical
// `npm run build`. Not correlated with the Sentry auth-token warning (which
// is benign and unrelated -- see next.config's Sentry options below). Root
// cause unconfirmed (a Vercel build-machine resource stall was suspected,
// but the account is on Pro, not Hobby, so that specific explanation
// doesn't clearly hold -- treat this as a verified-effective workaround for
// an unexplained stall, not a diagnosed fix). GitHub Actions CI already
// runs the full `npm run build` (typecheck) on every PR and push to main,
// so skip that same, resource-heavy pass on preview builds specifically to
// remove the hang risk; production builds keep full enforcement as a second
// safety net.
//
// Next.js 16 removed the `eslint` build option entirely (`next build` no
// longer lints at all, regardless of config) -- linting now only happens
// via the explicit `npm run lint` step in CI.
const isPreview = process.env.VERCEL_ENV === "preview";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typescript: {
    ignoreBuildErrors: isPreview,
  },
};

export default withSentryConfig(nextConfig, {
  // Org/project slugs and the auth token are only used for the source map upload. All three
  // are GitHub Actions config passed to CI's production `vercel build` (see env-vars.config.ts).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

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
