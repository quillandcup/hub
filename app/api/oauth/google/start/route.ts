import { requireAdmin } from "@/lib/supabase/api-auth";
import { buildAuthUrl } from "@/lib/google-photos-picker/client";
import { redirectUriFor } from "@/lib/google-photos-picker/redirect-uri";
import { setOAuthStateCookie } from "@/lib/google-photos-picker/import-session-cookie";
import { NextRequest, NextResponse } from "next/server";

// Provider-level, not feature-level (app/api/oauth/google, not
// .../google-photos) -- the registered OAuth Client ID's redirect URI is
// pinned to this exact path, and Google requires an exact match with no
// wildcards/path templating, so keeping this at the provider level means
// adding a second Google OAuth consumer later never requires touching the
// Google Cloud redirect URI config again. Only one flow (Google Photos
// picker) exists today, so this still only ever builds that one auth URL;
// see the callback route for the equivalent note.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

  const state = await setOAuthStateCookie(eventId);
  const authUrl = buildAuthUrl(redirectUriFor(request), state);

  return NextResponse.redirect(authUrl);
}
