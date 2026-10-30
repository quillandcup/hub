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
    const { program_id, name, starts_at, expires_at, notes } = body;

    if (!program_id || !name || !starts_at || !expires_at) {
      return NextResponse.json(
        { error: "Missing required fields: program_id, name, starts_at, expires_at" },
        { status: 400 }
      );
    }

    const cohort = await createRepos(supabase).programs.createCohort({
      program_id,
      name,
      starts_at,
      expires_at,
      notes: notes || null,
      created_by: user.id !== "service-role" ? user.id : null,
    });

    return NextResponse.json({ cohort }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create cohort" }, { status: 500 });
  }
}
