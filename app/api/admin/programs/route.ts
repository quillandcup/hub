import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { data: programs, error } = await supabase
    .from("programs")
    .select(`
      *,
      program_cohorts(id, member_program_enrollments(id))
    `)
    .order("name");

  if (error) {
    console.error("Error fetching programs:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const withCounts = (programs || []).map((p: any) => ({
    ...p,
    cohort_count: p.program_cohorts?.length ?? 0,
    enrollment_count: (p.program_cohorts || []).reduce(
      (sum: number, c: any) => sum + (c.member_program_enrollments?.length ?? 0),
      0
    ),
    program_cohorts: undefined,
  }));

  return NextResponse.json({ programs: withCounts });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { name, slug, description, kajabi_offer_names } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: "Missing required fields: name, slug" }, { status: 400 });
    }

    const { data: program, error } = await supabase
      .from("programs")
      .insert({
        name,
        slug,
        description: description || null,
        kajabi_offer_names: Array.isArray(kajabi_offer_names) ? kajabi_offer_names : [],
      })
      .select("*")
      .single();

    if (error) {
      console.error("Error creating program:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ program }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create program" }, { status: 500 });
  }
}
