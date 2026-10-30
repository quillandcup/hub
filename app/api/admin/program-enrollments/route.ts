import { ProgramEnrollmentExistsError } from "@/lib/data/programs";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { member_id, cohort_id, notes } = body;

    if (!member_id || !cohort_id) {
      return NextResponse.json({ error: "Missing required fields: member_id, cohort_id" }, { status: 400 });
    }

    const enrollment = await createRepos(supabase).programs.enroll({
      member_id,
      cohort_id,
      notes: notes || null,
      created_by: user.id !== "service-role" ? user.id : null,
    });

    return NextResponse.json({ enrollment }, { status: 201 });
  } catch (error: any) {
    if (error instanceof ProgramEnrollmentExistsError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create enrollment" }, { status: 500 });
  }
}
