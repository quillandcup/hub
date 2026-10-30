import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { findKajabiCandidatesForCohort } from "@/lib/kajabi-cohort-matching";
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

  const programs = createRepos(supabase).programs;
  let cohort;
  try {
    cohort = await programs.cohortForMatching(id);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Cohort not found" }, { status: 404 });
  }
  if (!cohort) return NextResponse.json({ error: "Cohort not found" }, { status: 404 });

  const program = cohort.program;
  if (!program) {
    return NextResponse.json({ error: "Cohort has no associated program" }, { status: 500 });
  }

  try {
    const { candidates, offerNamesConfigured } = await findKajabiCandidatesForCohort(
      supabase,
      { id: cohort.id, starts_at: cohort.starts_at, expires_at: cohort.expires_at },
      program
    );

    // Exclude members already enrolled in this exact cohort.
    const alreadyEnrolledIds = await programs.memberIdsInCohort(id);
    const filtered = candidates.filter((c) => !alreadyEnrolledIds.has(c.member_id));

    return NextResponse.json({ candidates: filtered, offerNamesConfigured });
  } catch (error: any) {
    console.error("Error finding Kajabi matches:", error);
    return NextResponse.json({ error: error.message || "Failed to find Kajabi matches" }, { status: 500 });
  }
}
