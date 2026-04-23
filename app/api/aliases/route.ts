import { createClient } from "@/lib/supabase/server";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

/**
 * Save name aliases for member matching
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
    const { matches } = body;

    if (!matches || !Array.isArray(matches)) {
      return NextResponse.json(
        { error: "matches array is required" },
        { status: 400 }
      );
    }

    // Insert aliases
    const aliasesToInsert = matches.map((match: any) => ({
      member_id: match.memberId,
      alias: match.zoomName,
    }));

    const { data, error } = await supabase
      .from("member_name_aliases")
      .insert(aliasesToInsert)
      .select();

    if (error) {
      console.error("Error inserting aliases:", error);
      throw error;
    }

    // Auto-trigger attendance reprocessing (last 90 days)
    console.log('Triggering attendance reprocessing from member_name_aliases change');
    await triggerReprocessing('member_name_aliases', 'local');

    return NextResponse.json({
      success: true,
      inserted: data?.length || 0,
    });
  } catch (error: any) {
    console.error("Error saving aliases:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save aliases" },
      { status: 500 }
    );
  }
}
