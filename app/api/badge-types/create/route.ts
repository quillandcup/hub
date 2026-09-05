import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

const VALID_CATEGORIES = ["milestone", "community", "course", "retreat", "special"];

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { name, description, icon, category, hasLevels, levels, eventId } = await request.json();

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

    const key = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "_")
      .trim();

    const { data: existing } = await supabase.from("badge_types").select("id").eq("key", key).single();
    if (existing) {
      return NextResponse.json({ error: "A badge type with this name already exists" }, { status: 409 });
    }

    const { data: badgeType, error: insertError } = await supabase
      .from("badge_types")
      .insert({
        key,
        name: name.trim(),
        description: description?.trim() || null,
        icon: icon?.trim() || "🏅",
        category: category ?? "community",
        has_levels: !!hasLevels,
        is_automatic: false,
        event_id: eventId || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating badge type:", insertError);
      if (insertError.code === "23505" && insertError.message.includes("event_id")) {
        return NextResponse.json({ error: "That event is already linked to another badge" }, { status: 409 });
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    if (eventId) {
      const { error: syncError } = await supabase.rpc("sync_event_badge_awards", { p_event_id: eventId });
      if (syncError) console.error("Error syncing event badge awards:", syncError);
    }

    if (hasLevels && Array.isArray(levels) && levels.length > 0) {
      const { error: levelsError } = await supabase.from("badge_levels").insert(
        levels.map((level: { level: number; name: string; threshold: number | null }) => ({
          badge_type_id: badgeType.id,
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

    return NextResponse.json({ badgeType }, { status: 201 });
  } catch (error: any) {
    console.error("Error in create badge type route:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
