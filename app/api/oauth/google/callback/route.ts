import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createPickerSession, exchangeCodeForToken } from "@/lib/google-photos-picker/client";
import { redirectUriFor } from "@/lib/google-photos-picker/redirect-uri";
import { setImportSessionCookie, verifyAndConsumeOAuthState } from "@/lib/google-photos-picker/import-session-cookie";
import { NextRequest, NextResponse } from "next/server";

// This exact path is what's registered as the OAuth Client's redirect URI in
// Google Cloud -- see the start route's comment on why it lives at the
// provider level. Only the Google Photos picker flow exists today, so this
// unconditionally does that flow's post-auth step (create a picker session);
// a second Google OAuth consumer would need a `purpose`/`flow` discriminator
// in `state` to dispatch, which isn't built since nothing needs it yet.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const errorParam = request.nextUrl.searchParams.get("error");

  // Best-effort event id for a nicer failure redirect even when state fails
  // verification -- untrusted, only used to pick where to send the error
  // banner (a same-origin admin path, never an open redirect).
  const unverifiedEventId = state?.split(":")[0];
  const failureUrl = new URL(
    unverifiedEventId ? `/admin/events/${unverifiedEventId}` : "/admin/events",
    request.nextUrl.origin
  );

  if (errorParam || !code) {
    failureUrl.searchParams.set("photo_import_error", errorParam || "missing_code");
    return NextResponse.redirect(failureUrl);
  }

  const eventId = await verifyAndConsumeOAuthState(state);
  if (!eventId) {
    failureUrl.searchParams.set("photo_import_error", "invalid_state");
    return NextResponse.redirect(failureUrl);
  }
  // The event's address (its slug) for where to send the admin next; the id would only redirect there.
  const event = await createRepos(auth.supabase).events.byId(eventId).catch(() => null);
  const eventPath = `/admin/events/${event?.slug ?? eventId}`;

  try {
    const { accessToken, expiresInSeconds } = await exchangeCodeForToken(code, redirectUriFor(request));
    const session = await createPickerSession(accessToken);

    // Cap at the shorter of the access token's real lifetime and 55 minutes
    // -- matches the Picker API's baseUrl validity window (~60 min).
    const maxAgeSeconds = Math.min(expiresInSeconds, 55 * 60);
    await setImportSessionCookie(
      {
        eventId,
        accessToken,
        sessionId: session.id,
        pickerUri: session.pickerUri,
        expiresAt: new Date(Date.now() + maxAgeSeconds * 1000).toISOString(),
      },
      maxAgeSeconds
    );

    return NextResponse.redirect(new URL(`${eventPath}/import-photos`, request.nextUrl.origin));
  } catch (error: any) {
    console.error("Error starting Google Photos import:", error);
    const eventFailureUrl = new URL(eventPath, request.nextUrl.origin);
    eventFailureUrl.searchParams.set("photo_import_error", "start_failed");
    return NextResponse.redirect(eventFailureUrl);
  }
}
