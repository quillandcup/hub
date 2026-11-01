import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
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
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { start_date, end_date, reason, notes } = body;

    const updates: any = {};
    if (start_date !== undefined) updates.start_date = start_date;
    if (end_date !== undefined) updates.end_date = end_date;
    if (reason !== undefined) updates.reason = reason;
    if (notes !== undefined) updates.notes = notes;

    const hiatus = await createRepos(supabase).memberStatus.updateHiatus(id, updates);

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

    const memberStatus = createRepos(supabase).memberStatus;
    const existing = await memberStatus.hiatusById(id);
    await memberStatus.deleteHiatus(id);

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
