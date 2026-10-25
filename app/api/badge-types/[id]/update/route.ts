import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

const VALID_CATEGORIES = ["milestone", "community", "course", "retreat", "special"];

// Replaces name/description/icon/category and the full set of levels for a badge type.
// Levels are DELETE + INSERT (not diffed) -- same "reconcile in full" shape as the codebase's
// other DELETE+INSERT layers, and simple to reason about for what's a low-traffic admin form.
// is_automatic is otherwise seed-time only (the badge's computation lives in lib/badges.ts, not
// in data) -- the one exception is program_id, which drives is_automatic directly: linking a
// program makes the badge computed, unlinking reverts it to a plain manual badge.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { id } = await params;
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const { name, description, icon, category, hasLevels, levels, eventId, programId } = parsed;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }
    if (hasLevels && (!Array.isArray(levels) || levels.length === 0)) {
      return NextResponse.json(
        { error: "At least one level is required when hasLevels is true" },
        { status: 400 }
      );
    }

    const badges = createRepos(supabase).badges;
    const current = await badges.typeById(id);
    // Only touch is_automatic when program_id is actually changing -- leave it alone for
    // badges whose automation is code-driven (founding_hedgie, prickle_milestones, ...) and
    // that never had a program_id to begin with.
    const isAutomatic = programId ? true : current?.program_id ? false : undefined;

    const updated = await badges.updateType(id, {
      name: name.trim(),
      description: description?.trim() || null,
      icon: icon?.trim() || "🏅",
      category: category ?? "community",
      hasLevels: !!hasLevels,
      eventId: eventId || null,
      programId: programId || null,
      isAutomatic,
    });
    if (!updated.ok) {
      if (updated.reason === "event_taken") {
        return NextResponse.json({ error: "That event is already linked to another badge" }, { status: 409 });
      }
      return NextResponse.json({ error: "Badge type not found" }, { status: 404 });
    }
    const badgeType = updated.badgeType;

    if (eventId) {
      const { error: syncError } = await supabase.rpc("sync_event_badge_awards", { p_event_id: eventId });
      if (syncError) console.error("Error syncing event badge awards:", syncError);
    }

    await badges.replaceLevels(id, hasLevels && Array.isArray(levels) ? levels.map((l: { level: number; name: string; threshold: number | null }) => ({ level: l.level, name: l.name, threshold: l.threshold ?? null })) : []);

    return NextResponse.json({ badgeType });
  } catch (error: any) {
    console.error("Error in update badge type route:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
