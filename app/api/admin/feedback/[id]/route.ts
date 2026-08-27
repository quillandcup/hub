import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/api-auth";

const STATUSES = ["new", "acknowledged", "resolved", "wontfix"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const body = await request.json();
  const update: { status?: string; admin_notes?: string } = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = body.status;
  }
  if (body.admin_notes !== undefined) {
    update.admin_notes = body.admin_notes;
  }

  const { error } = await supabase.from("feedback").update(update).eq("id", id);
  if (error) {
    console.error("Feedback update failed:", error);
    return NextResponse.json({ error: "Failed to update feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
