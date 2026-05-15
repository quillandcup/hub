import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * Mark multiple unmatched calendar events as ignored
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { unmatchedEventIds } = body;

    if (!unmatchedEventIds?.length) {
      return NextResponse.json(
        { error: "Missing unmatchedEventIds" },
        { status: 400 }
      );
    }

    // Mark all unmatched events as ignored
    const { error } = await supabase
      .from("unmatched_calendar_events")
      .update({
        status: "ignored",
        resolved_at: new Date().toISOString(),
      })
      .in("id", unmatchedEventIds);

    if (error) {
      console.error("Error ignoring events:", error);
      return NextResponse.json(
        { error: "Failed to ignore events" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Ignored ${unmatchedEventIds.length} event(s) successfully`,
      count: unmatchedEventIds.length,
    });
  } catch (error: any) {
    console.error("Error ignoring events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to ignore events" },
      { status: 500 }
    );
  }
}
