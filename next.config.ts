import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs/config";

// Preview deployments have intermittently hung indefinitely (~45 min, then
// force-errored with no diagnostic output) during Next.js's combined
// "Linting and checking validity of types" build phase -- reproduced across
// multiple unrelated branches/commits/times, never in GitHub Actions CI
// running the identical `npm run build`. Not correlated with the Sentry
// auth-token warning (which is benign and unrelated -- see next.config's
// Sentry options below). Root cause unconfirmed (a Vercel build-machine
// resource stall was suspected, but the account is on Pro, not Hobby, so
// that specific explanation doesn't clearly hold -- treat this as a
// verified-effective workaround for an unexplained stall, not a diagnosed
// fix). GitHub Actions CI already runs the full `npm run build` (lint +
// typecheck) on every PR and push to main, so skip that same, resource-heavy
// pass on preview builds specifically to remove the hang risk; production
// builds keep full enforcement as a second safety net.
const isPreview = process.env.VERCEL_ENV === "preview";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  eslint: {
    ignoreDuringBuilds: isPreview,
  },
  typescript: {
    ignoreBuildErrors: isPreview,
  },
};

export default withSentryConfig(nextConfig, {
  org: "quillandcup",
  project: "hub",

  // Source map upload auth token — set SENTRY_AUTH_TOKEN in the environment
  // (build-time secret, generated at sentry.io/settings/account/api/auth-tokens)
  // to enable readable production stack traces. Builds succeed without it;
  // source maps just won't upload. It's deliberately Production-only in
  // Vercel, so skip the upload attempt entirely on Preview/dev instead of
  // just accepting the "No auth token provided" warning noise every build.
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
