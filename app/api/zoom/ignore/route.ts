import { requireAdmin } from "@/lib/supabase/api-auth";
import { isId } from "@/lib/ids";
import { createRepos } from "@/lib/data/repos";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/zoom/ignore
 *
 * Ignore a Zoom name so it no longer appears in the unmatched list.
 * With `prickleId` only that prickle's appearance is ignored; without it the name is
 * ignored everywhere, for every future appearance.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { zoomName, reason, prickleId } = body;

    if (!zoomName) {
      return NextResponse.json(
        { error: "zoomName is required" },
        { status: 400 }
      );
    }

    if (prickleId !== undefined && prickleId !== null) {
      if (!isId(prickleId, "prkl")) {
        return NextResponse.json({ error: "Invalid prickleId" }, { status: 400 });
      }
      try {
        await createRepos(supabase).zoom.ignoreAppearance({ prickleId, zoomName, reason: reason || null, ignoredBy: user.id });
      } catch (error: any) {
        console.error("Error ignoring Zoom name for one prickle:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      // Attendance processing doesn't read this table, so there is nothing to reprocess.
      return NextResponse.json({ success: true });
    }

    // Insert into ignored list
    try {
      await createRepos(supabase).zoom.ignoreName({ zoomName, reason: reason || null, ignoredBy: user.id });
    } catch (error: any) {
      console.error("Error ignoring Zoom name:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auto-trigger attendance reprocessing (last 90 days)
    console.log('Triggering attendance reprocessing from ignored_zoom_names change');
    await triggerReprocessing('ignored_zoom_names', 'local');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in ignore route:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/zoom/ignore
 *
 * Un-ignore a Zoom name (with `prickleId`, only that prickle's appearance)
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { zoomName, prickleId } = body;

    if (!zoomName) {
      return NextResponse.json(
        { error: "zoomName is required" },
        { status: 400 }
      );
    }

    if (prickleId !== undefined && prickleId !== null) {
      if (!isId(prickleId, "prkl")) {
        return NextResponse.json({ error: "Invalid prickleId" }, { status: 400 });
      }
      try {
        await createRepos(supabase).zoom.unignoreAppearance(prickleId, zoomName);
      } catch (error: any) {
        console.error("Error un-ignoring Zoom name for one prickle:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    try {
      await createRepos(supabase).zoom.unignoreName(zoomName);
    } catch (error: any) {
      console.error("Error un-ignoring Zoom name:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auto-trigger attendance reprocessing (last 90 days)
    console.log('Triggering attendance reprocessing from ignored_zoom_names change');
    await triggerReprocessing('ignored_zoom_names', 'local');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in un-ignore route:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
