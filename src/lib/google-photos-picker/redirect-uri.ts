import { NextRequest } from "next/server";

/**
 * Shared by the oauth/start and oauth/callback routes -- must match exactly,
 * since Google requires an exact redirect_uri match (no wildcards/path
 * templating). This is one static path per origin, registered as-is in the
 * Google Cloud OAuth client -- the event id travels via the `state` param
 * instead (see import-session-cookie.ts), not the URL.
 */
export function redirectUriFor(request: NextRequest): string {
  return `${request.nextUrl.origin}/api/oauth/google/callback`;
}
