import { requireAdmin } from "@/lib/supabase/api-auth";
import { recomputeMemberStatus } from "@/lib/member-status";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { start_date, end_date, reason, notes } = body;

    const updates: any = {};
    if (start_date !== undefined) updates.start_date = start_date;
    if (end_date !== undefined) updates.end_date = end_date;
    if (reason !== undefined) updates.reason = reason;
    if (notes !== undefined) updates.notes = notes;

    const { data: hiatus, error } = await supabase
      .from("member_hiatus_history")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("Error updating member hiatus:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!hiatus) {
      return NextResponse.json({ error: "Hiatus not found" }, { status: 404 });
    }

    await recomputeMemberStatus(supabase, hiatus.member_id);

    return NextResponse.json({ hiatus });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update hiatus" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { id } = await params;

    const { data: existing } = await supabase
      .from("member_hiatus_history")
      .select("member_id")
      .eq("id", id)
      .single();

    const { error } = await supabase.from("member_hiatus_history").delete().eq("id", id);

    if (error) {
      console.error("Error deleting member hiatus:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (existing) await recomputeMemberStatus(supabase, existing.member_id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete hiatus" },
      { status: 500 }
    );
  }
}
