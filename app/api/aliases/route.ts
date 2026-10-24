import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { adminNameAliasConflictMessage, findNameAliasConflict } from "@/lib/name-alias-conflict";
import { NextRequest, NextResponse } from "next/server";

/**
 * Save name aliases for member matching
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
    const { matches } = body;

    if (!matches || !Array.isArray(matches)) {
      return NextResponse.json(
        { error: "matches array is required" },
        { status: 400 }
      );
    }

    // Check every name first (all or nothing): one that is already someone's, or is another
    // member's real name, would take that member's attendance.
    const checks = await Promise.all(
      matches.map((match: any) => findNameAliasConflict(match.memberId, match.zoomName))
    );
    const problems: string[] = [];
    checks.forEach((checked, i) => {
      if ("error" in checked) problems.push(checked.error);
      else if (checked.conflict) problems.push(adminNameAliasConflictMessage(matches[i].zoomName, checked.conflict));
    });
    if (problems.length > 0) {
      return NextResponse.json({ error: problems.join(" ") }, { status: 409 });
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
