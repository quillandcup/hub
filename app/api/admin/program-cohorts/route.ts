import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { program_id, name, starts_at, expires_at, notes } = body;

    if (!program_id || !name || !starts_at || !expires_at) {
      return NextResponse.json(
        { error: "Missing required fields: program_id, name, starts_at, expires_at" },
        { status: 400 }
      );
    }

    const { data: cohort, error } = await supabase
      .from("program_cohorts")
      .insert({
        program_id,
        name,
        starts_at,
        expires_at,
        notes: notes || null,
        created_by: user.id !== "service-role" ? user.id : null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Error creating program cohort:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ cohort }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create cohort" }, { status: 500 });
  }
}
