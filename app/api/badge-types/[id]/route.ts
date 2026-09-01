import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Hard delete -- badge_types is an admin-curated LOCAL definitions table (see CLAUDE.md),
// not attendance/event history that needs preserving. badge_levels and member_badges both
// have ON DELETE CASCADE on badge_type_id, so this also removes the badge's levels and any
// awards logged against it.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { id } = await params;

    const { data: badgeType } = await supabase.from("badge_types").select("is_automatic").eq("id", id).single();
    if (!badgeType) return NextResponse.json({ error: "Badge type not found" }, { status: 404 });
    if (badgeType.is_automatic) {
      return NextResponse.json(
        { error: "Automatic badges are computed in code and can't be deleted here" },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("badge_types").delete().eq("id", id);
    if (error) {
      console.error("Error deleting badge type:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in delete badge type route:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
