import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { adminNameAliasConflictMessage, findNameAliasConflict } from "@/lib/name-alias-conflict";
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
 * Matches by zoom_name alone, not the (zoom_name, zoom_email) key, so an
 * entry seen both with and without an email is cleared in one action.
 *
 * The alias is checked first (lib/name-alias-conflict.ts): a name that is
 * another member's alias or real name is refused (409) rather than reassigned.
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
    const { zoomName, memberId, action } = body;

    if (!zoomName) {
      return NextResponse.json({ error: "zoomName is required" }, { status: 400 });
    }

    if (action === "ignore") {
      try {
        await createRepos(supabase).zoom.ignoreAmbiguousName(zoomName);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (!memberId) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }

    // Don't take a name from another member (the upsert below would reassign it silently) or
    // shadow another member's real name. Already this member's own active alias: nothing to add.
    const checked = await findNameAliasConflict(memberId, zoomName);
    if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 500 });
    const { conflict } = checked;
    // A Zoom name that matched several members is ambiguous because it is somebody's real name (and
    // others' aliases or first names). Choosing who uses it is the point, so another member's real
    // name is allowed here, as long as an unresolved entry exists for it: the alias then wins over
    // the full-name match. Another member's alias is still refused.
    let allowedRealNameShadow = false;
    if (conflict?.kind === "other_name") {
      try {
        allowedRealNameShadow = await createRepos(supabase).zoom.hasUnresolvedAmbiguousName(zoomName);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
      }
    }
    if (conflict && conflict.kind !== "own" && !allowedRealNameShadow) {
      return NextResponse.json({ error: adminNameAliasConflictMessage(zoomName, conflict) }, { status: 409 });
    }

    if (!conflict || allowedRealNameShadow) {
      try {
        await createRepos(supabase).aliases.upsertName(memberId, zoomName, "zoom");
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
      }
    }

    try {
      await createRepos(supabase).zoom.resolveAmbiguousName(zoomName, memberId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }

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
