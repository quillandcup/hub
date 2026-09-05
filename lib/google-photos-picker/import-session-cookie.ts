import { cookies } from "next/headers";
import { randomBytes } from "crypto";

/**
 * Short-lived, httpOnly cookies that carry the Google OAuth access token and
 * Picker session across the oauth/start -> callback -> import/status ->
 * import/commit request sequence. Deliberately not persisted to the
 * database -- this is a one-time, admin-initiated import, not a background
 * sync, so there's no reason to keep a long-lived Google credential around
 * (see lib/google-photos-picker/client.ts's access_type=online).
 */

const OAUTH_STATE_COOKIE = "gphotos_oauth_state";
const IMPORT_SESSION_COOKIE = "gphotos_import";

const isProduction = process.env.VERCEL_ENV === "production";

export interface ImportSessionCookiePayload {
  eventId: string;
  accessToken: string;
  sessionId: string;
  pickerUri: string;
  expiresAt: string; // ISO timestamp
}

export async function setOAuthStateCookie(eventId: string): Promise<string> {
  const state = `${eventId}:${randomBytes(16).toString("hex")}`;
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return state;
}

/**
 * Verifies the callback's `state` param against the cookie set in
 * setOAuthStateCookie, clears it either way, and returns the event id
 * encoded in it. The callback route is a single static URL (Google requires
 * an exact redirect_uri match, no path templating), so the event id can't
 * travel in the path -- it rides in `state` instead.
 */
export async function verifyAndConsumeOAuthState(state: string | null): Promise<string | null> {
  const cookieStore = await cookies();
  const expected = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);
  if (!expected || !state || expected !== state) return null;
  const [eventId] = expected.split(":");
  return eventId || null;
}

export async function setImportSessionCookie(payload: ImportSessionCookiePayload, maxAgeSeconds: number): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(IMPORT_SESSION_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function getImportSessionCookie(eventId: string): Promise<ImportSessionCookiePayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(IMPORT_SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as ImportSessionCookiePayload;
    if (payload.eventId !== eventId) return null;
    if (new Date(payload.expiresAt).getTime() <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function clearImportSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(IMPORT_SESSION_COOKIE);
}
