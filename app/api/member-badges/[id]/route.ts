import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Revokes one badge occurrence. For a leveled badge type, deleting one row can drop the
// member's derived level (see lib/badges.ts deriveLevel()) rather than remove the badge outright.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { id } = await params;

    const { error } = await supabase.from("member_badges").delete().eq("id", id);

    if (error) {
      console.error("Error revoking badge:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in revoke badge route:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
