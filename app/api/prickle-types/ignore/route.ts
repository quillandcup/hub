import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Mark an unmatched calendar event as ignored
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { unmatchedEventId } = body;

    if (!unmatchedEventId) {
      return NextResponse.json(
        { error: "Missing unmatchedEventId" },
        { status: 400 }
      );
    }

    // Mark the unmatched event as ignored
    const { error } = await supabase
      .from("unmatched_calendar_events")
      .update({
        status: "ignored",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", unmatchedEventId);

    if (error) {
      console.error("Error ignoring event:", error);
      return NextResponse.json(
        { error: "Failed to ignore event" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Event ignored successfully",
    });
  } catch (error: any) {
    console.error("Error ignoring event:", error);
    return NextResponse.json(
      { error: error.message || "Failed to ignore event" },
      { status: 500 }
    );
  }
}
