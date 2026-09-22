import { requireAdmin } from "@/lib/supabase/api-auth";
import { fetchAllRows, chunk } from "@/lib/supabase/paginate";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { id } = await params;

  const { data: segment, error } = await supabase
    .from("segments")
    .select("id, name, created_at, created_by")
    .eq("id", id)
    .single();

  if (error || !segment) {
    return NextResponse.json({ error: error?.message ?? "Segment not found" }, { status: 404 });
  }

  const memberLinks = await fetchAllRows<{ member_id: string }>((from, to) =>
    supabase.from("segment_members").select("member_id").eq("segment_id", id).range(from, to)
  );

  const memberIds = memberLinks.map((m) => m.member_id);
  let members: { id: string; name: string; email: string }[] = [];
  for (const idBatch of chunk(memberIds, 500)) {
    const { data } = await supabase.from("members").select("id, name, email").in("id", idBatch);
    members = members.concat(data ?? []);
  }
  members.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ segment, members });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { id } = await params;

  // segment_members and feature_flag_segments both cascade on delete
  const { error } = await supabase.from("segments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
