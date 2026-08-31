import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Logs one occurrence of a badge for a member (e.g. one quarter hosted, one retreat attended).
// For a has_levels badge type this doesn't set a level directly -- the member's displayed level
// is derived from how many occurrence rows they have (see lib/badges.ts deriveLevel()), so
// awarding the same badge type again is how an admin "levels someone up".
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const { memberId, badgeTypeId, occurredAt, note } = await request.json();

    if (!memberId || !badgeTypeId) {
      return NextResponse.json({ error: "memberId and badgeTypeId are required" }, { status: 400 });
    }

    const { data: badgeType, error: badgeTypeError } = await supabase
      .from("badge_types")
      .select("id, is_automatic")
      .eq("id", badgeTypeId)
      .single();
    if (badgeTypeError || !badgeType) {
      return NextResponse.json({ error: "Badge type not found" }, { status: 404 });
    }
    if (badgeType.is_automatic) {
      return NextResponse.json(
        { error: "This badge is computed automatically and can't be manually awarded" },
        { status: 400 }
      );
    }

    const { data: memberBadge, error } = await supabase
      .from("member_badges")
      .insert({
        member_id: memberId,
        badge_type_id: badgeTypeId,
        occurred_at: occurredAt || undefined,
        note: note?.trim() || null,
        awarded_by: user.id !== "service-role" && user.id !== "cron" ? user.id : null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error awarding badge:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ memberBadge }, { status: 201 });
  } catch (error: any) {
    console.error("Error in award badge route:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
