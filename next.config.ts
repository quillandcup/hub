import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default withSentryConfig(nextConfig, {
  org: "quillandcup",
  project: "hub",

  // Source map upload auth token — set SENTRY_AUTH_TOKEN in the environment
  // (build-time secret, generated at sentry.io/settings/account/api/auth-tokens)
  // to enable readable production stack traces. Builds succeed without it;
  // source maps just won't upload.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of client source files for better stack trace resolution.
  widenClientFileUpload: true,

  // Route Sentry client requests through our own domain to bypass ad-blockers.
  tunnelRoute: "/monitoring",

  // Suppress non-CI build output noise.
  silent: !process.env.CI,
});
