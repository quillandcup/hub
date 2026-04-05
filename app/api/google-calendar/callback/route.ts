import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * Handle Google Calendar OAuth callback
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        new URL(`/dashboard/import?error=${encodeURIComponent(error)}`, request.url)
      );
    }

    if (!code) {
      return NextResponse.json(
        { error: "No authorization code provided" },
        { status: 400 }
      );
    }

    const client = new GoogleCalendarClient();
    const tokens = await client.getTokensFromCode(code);

    // In production, you'd store these tokens securely in the database
    // For now, we'll redirect back with the refresh token in the URL
    // This is NOT secure for production - just for development
    const refreshToken = tokens.refresh_token;

    return NextResponse.redirect(
      new URL(
        `/dashboard/import?gcal_auth=success&refresh_token=${refreshToken}`,
        request.url
      )
    );
  } catch (error: any) {
    console.error("Error in OAuth callback:", error);
    return NextResponse.redirect(
      new URL(
        `/dashboard/import?error=${encodeURIComponent(error.message || "OAuth failed")}`,
        request.url
      )
    );
  }
}
