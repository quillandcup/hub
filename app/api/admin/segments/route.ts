import { requireAdmin } from "@/lib/supabase/api-auth";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const [{ data: segments, error }, memberRows] = await Promise.all([
    supabase
      .from("segments")
      .select("id, name, created_at, created_by")
      .order("created_at", { ascending: false }),
    fetchAllRows<{ segment_id: string }>((from, to) =>
      supabase.from("segment_members").select("segment_id").range(from, to)
    ),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const row of memberRows) counts.set(row.segment_id, (counts.get(row.segment_id) ?? 0) + 1);

  const result = (segments ?? []).map((s) => ({ ...s, memberCount: counts.get(s.id) ?? 0 }));

  return NextResponse.json({ segments: result });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  const { name } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("segments")
    .insert({
      name: name.trim(),
      created_by: user.id !== "service-role" && user.id !== "cron" ? user.id : null,
    })
    .select("id, name, created_at, created_by")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ segment: { ...data, memberCount: 0 } });
}
