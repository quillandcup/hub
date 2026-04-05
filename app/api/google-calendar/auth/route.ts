import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { NextResponse } from "next/server";

/**
 * Initiate Google Calendar OAuth flow
 */
export async function GET() {
  try {
    const client = new GoogleCalendarClient();
    const authUrl = client.getAuthUrl();

    return NextResponse.json({ authUrl });
  } catch (error: any) {
    console.error("Error generating auth URL:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate auth URL" },
      { status: 500 }
    );
  }
}
