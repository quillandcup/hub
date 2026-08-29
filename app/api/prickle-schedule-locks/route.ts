import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { data: locks, error } = await supabase.from("prickle_schedule_locks").select("*").order("month");

  if (error) {
    console.error("Error fetching prickle_schedule_locks:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ locks });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { month, locked, notes } = body;

    if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 });
    if (typeof locked !== "boolean") return NextResponse.json({ error: "locked must be a boolean" }, { status: 400 });

    const { data: lock, error } = await supabase
      .from("prickle_schedule_locks")
      .upsert(
        {
          month,
          locked,
          notes: notes || null,
          locked_by: user.id !== "service-role" ? user.id : null,
          locked_at: new Date().toISOString(),
        },
        { onConflict: "month" }
      )
      .select("*")
      .single();

    if (error) {
      console.error("Error upserting prickle_schedule_lock:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ lock });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to update lock" }, { status: 500 });
  }
}
