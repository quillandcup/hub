import { getCurrentUser } from "@/lib/auth";

/**
 * The ID to identify this visitor by in Google Analytics (see
 * lib/analytics-identity.ts): the signed-in user's auth ID, or null when GA is
 * off (no measurement ID, i.e. outside production) or nobody is signed in.
 * Server-only; shares the render's cached auth check.
 */
export async function analyticsUserId(gaId: string | undefined): Promise<string | null> {
  if (!gaId) return null;
  return (await getCurrentUser())?.id ?? null;
}
