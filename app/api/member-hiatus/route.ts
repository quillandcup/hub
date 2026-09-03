import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { member_id, start_date, end_date, reason, notes } = body;

    if (!member_id || !start_date) {
      return NextResponse.json(
        { error: "Missing required fields: member_id, start_date" },
        { status: 400 }
      );
    }

    const { data: hiatus, error } = await supabase
      .from("member_hiatus_history")
      .insert({
        member_id,
        start_date,
        end_date: end_date || null,
        reason: reason || null,
        notes: notes || null,
        created_by: user.id !== "service-role" ? user.id : null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Error creating member hiatus:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ hiatus }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create hiatus" },
      { status: 500 }
    );
  }
}
