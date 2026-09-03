import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/zoom/resolve-ambiguous
 *
 * Resolves an ambiguous_zoom_names entry -- a Zoom display name that matched
 * more than one member, which attendance processing therefore skipped
 * entirely (see matchAttendeeToMember's AmbiguousMatch branch). Two actions:
 *
 * - { zoomName, memberId }: creates/overwrites the member_name_aliases row
 *   for this exact string (alias is globally UNIQUE, so this is the
 *   disambiguation), marks all matching unresolved rows resolved, and
 *   triggers reprocessing so past attendance in the affected window gets
 *   recomputed.
 * - { zoomName, action: "ignore" }: marks the entry ignored without creating
 *   an alias (e.g. a one-off typo/nickname not worth wiring up).
 *
 * Matches by zoom_name alone (not the (zoom_name, zoom_email) unique key) --
 * NULL zoom_email values don't dedupe under that constraint, so the same
 * bare name can accumulate several identical unresolved rows; this clears
 * all of them in one action.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { zoomName, memberId, action } = body;

    if (!zoomName) {
      return NextResponse.json({ error: "zoomName is required" }, { status: 400 });
    }

    if (action === "ignore") {
      const { error } = await supabase
        .from("ambiguous_zoom_names")
        .update({ status: "ignored" })
        .eq("zoom_name", zoomName)
        .eq("status", "unresolved");

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    if (!memberId) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }

    const { error: aliasError } = await supabase
      .from("member_name_aliases")
      .upsert({ member_id: memberId, alias: zoomName, source: "zoom" }, { onConflict: "alias" });

    if (aliasError) return NextResponse.json({ error: aliasError.message }, { status: 500 });

    const { error: resolveError } = await supabase
      .from("ambiguous_zoom_names")
      .update({ status: "resolved", resolved_member_id: memberId })
      .eq("zoom_name", zoomName)
      .eq("status", "unresolved");

    if (resolveError) return NextResponse.json({ error: resolveError.message }, { status: 500 });

    console.log("Triggering attendance reprocessing from ambiguous_zoom_names resolution");
    await triggerReprocessing("member_name_aliases", "local");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error resolving ambiguous Zoom name:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
