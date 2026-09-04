import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { member_id, cohort_id, notes } = body;

    if (!member_id || !cohort_id) {
      return NextResponse.json({ error: "Missing required fields: member_id, cohort_id" }, { status: 400 });
    }

    const { data: enrollment, error } = await supabase
      .from("member_program_enrollments")
      .insert({
        member_id,
        cohort_id,
        notes: notes || null,
        created_by: user.id !== "service-role" ? user.id : null,
      })
      .select(`
        *,
        member:members(id, name, email)
      `)
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "This member is already enrolled in this cohort" }, { status: 409 });
      }
      console.error("Error creating program enrollment:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ enrollment }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create enrollment" }, { status: 500 });
  }
}
