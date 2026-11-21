import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * Mark an unmatched calendar event as ignored
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { unmatchedEventId } = body;

    if (!unmatchedEventId) {
      return NextResponse.json(
        { error: "Missing unmatchedEventId" },
        { status: 400 }
      );
    }

    // Mark the unmatched event as ignored
    try {
      await createRepos(supabase).unmatchedEvents.markIgnored([unmatchedEventId], new Date().toISOString());
    } catch (error) {
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
