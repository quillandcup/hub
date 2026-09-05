/**
 * Google Photos Picker API client.
 *
 * Unlike lib/google-calendar/client.ts, this can't use a service account --
 * the Photos API only supports per-user OAuth consent, and Google removed the
 * old shared-album read scopes (sharedAlbums.*, photoslibrary.readonly) in
 * April 2025. The Picker API is the only remaining path: a human opens
 * Google's picker UI and selects photos/videos, and the app fetches the
 * picked items' bytes via a short-lived baseUrl.
 *
 * Scope: https://www.googleapis.com/auth/photospicker.mediaitems.readonly
 * No refresh token is requested (access_type=online) -- everything here
 * happens within one admin-initiated import, not a background sync.
 */

const PICKER_API_BASE = "https://photospicker.googleapis.com/v1";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const PHOTOS_PICKER_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";

function getClientCredentials() {
  // Named after the provider, not this feature -- same OAuth Client ID
  // backs app/api/oauth/google/{start,callback}, shared by any future
  // Google user-consent flow, not just the Photos Picker.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not configured");
  }
  return { clientId, clientSecret };
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: PHOTOS_PICKER_SCOPE,
    access_type: "online",
    prompt: "consent",
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const { clientId, clientSecret } = getClientCredentials();
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to exchange code for token: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

export interface PickerSession {
  id: string;
  pickerUri: string;
  mediaItemsSet: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
  expireTime?: string;
}

async function pickerFetch(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`${PICKER_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(`Google Photos Picker API error (${path}): ${response.status} ${await response.text()}`);
  }
  return response.json();
}

export async function createPickerSession(accessToken: string): Promise<PickerSession> {
  return pickerFetch("/sessions", accessToken, { method: "POST" });
}

export async function getPickerSession(accessToken: string, sessionId: string): Promise<PickerSession> {
  return pickerFetch(`/sessions/${sessionId}`, accessToken);
}

export async function deletePickerSession(accessToken: string, sessionId: string): Promise<void> {
  await fetch(`${PICKER_API_BASE}/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export interface PickedMediaItem {
  id: string;
  createTime?: string;
  type: "PHOTO" | "VIDEO";
  mediaFile: {
    baseUrl: string;
    mimeType: string;
    filename: string;
    mediaFileMetadata?: { width?: string; height?: string };
  };
}

export async function listPickedMediaItems(accessToken: string, sessionId: string): Promise<PickedMediaItem[]> {
  let items: PickedMediaItem[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await pickerFetch(`/mediaItems?${params.toString()}`, accessToken);
    items = items.concat(data.mediaItems ?? []);
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
  return items;
}

/** Parses a Google API duration string like "3.5s" into milliseconds, with a sane fallback. */
export function parseDurationMs(duration: string | undefined, fallbackMs: number): number {
  if (!duration) return fallbackMs;
  const match = /^([\d.]+)s$/.exec(duration.trim());
  if (!match) return fallbackMs;
  const seconds = parseFloat(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : fallbackMs;
}

/** Fetches the original bytes for a picked media item. `=d` requests the download variant. */
export async function downloadMediaItemBytes(
  baseUrl: string,
  accessToken: string
): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(`${baseUrl}=d`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to download media item bytes: ${response.status} ${await response.text()}`);
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, contentType };
}
