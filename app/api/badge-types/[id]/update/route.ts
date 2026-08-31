import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

const VALID_CATEGORIES = ["milestone", "community", "course", "retreat", "special"];

// Replaces name/description/icon/category and the full set of levels for a badge type.
// Levels are DELETE + INSERT (not diffed) -- same "reconcile in full" shape as the codebase's
// other DELETE+INSERT layers, and simple to reason about for what's a low-traffic admin form.
// is_automatic is never touched here: it's set only at seed time (the badge's computation lives
// in lib/badges.ts, not in data), so this route has no way to turn a manual badge type automatic.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { id } = await params;
    const { name, description, icon, category, hasLevels, levels } = await request.json();

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

    const { data: badgeType, error: updateError } = await supabase
      .from("badge_types")
      .update({
        name: name.trim(),
        description: description?.trim() || null,
        icon: icon?.trim() || "🏅",
        category: category ?? "community",
        has_levels: !!hasLevels,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating badge type:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    if (!badgeType) {
      return NextResponse.json({ error: "Badge type not found" }, { status: 404 });
    }

    const { error: deleteError } = await supabase.from("badge_levels").delete().eq("badge_type_id", id);
    if (deleteError) {
      console.error("Error clearing badge levels:", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (hasLevels && Array.isArray(levels) && levels.length > 0) {
      const { error: levelsError } = await supabase.from("badge_levels").insert(
        levels.map((level: { level: number; name: string; threshold: number | null }) => ({
          badge_type_id: id,
          level: level.level,
          name: level.name,
          threshold: level.threshold ?? null,
        }))
      );
      if (levelsError) {
        console.error("Error creating badge levels:", levelsError);
        return NextResponse.json({ error: levelsError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ badgeType });
  } catch (error: any) {
    console.error("Error in update badge type route:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
