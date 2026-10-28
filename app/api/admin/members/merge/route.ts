import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import type { ExternalIds, Member } from "@/lib/data/members";
import type { Insert } from "@/lib/data/db";
import { NextRequest, NextResponse } from "next/server";

// Throws on a Supabase error instead of letting the merge carry on: the
// secondary is deleted at the end, and anything still pointing at it then
// cascades away (email aliases, schedules) or is nulled.
async function run(query: PromiseLike<{ error: unknown }>) {
  const { error } = await query;
  if (error) throw error;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { primaryId, secondaryId } = parsed;

  if (!primaryId || !secondaryId) {
    return NextResponse.json({ error: "primaryId and secondaryId are required" }, { status: 400 });
  }
  if (primaryId === secondaryId) {
    return NextResponse.json({ error: "Cannot merge a member into themselves" }, { status: 400 });
  }

  // The columns merged below, under their table names (they key the patch written back).
  const mergeable = (m: Member | null) =>
    m && { id: m.id, name: m.name, email: m.email, kajabi_id: m.kajabiId, stripe_customer_id: m.stripeCustomerId, user_id: m.userId };
  const repo = createRepos(supabase).members;
  const [primary, secondary] = (await Promise.all([repo.byId(primaryId), repo.byId(secondaryId)])).map(mergeable);

  if (!primary) return NextResponse.json({ error: "Primary member not found" }, { status: 404 });
  if (!secondary) return NextResponse.json({ error: "Secondary member not found" }, { status: 404 });

  // Track conflicts where both members have different non-null values.
  // The primary always wins — we note discarded secondary values.
  const conflicts: { field: string; kept: string; discarded: string }[] = [];

  // Build a patch to fill in any external IDs the primary is missing from the secondary.
  const primaryPatch: Record<string, string> = {};
  const idsToFill: ExternalIds = {};
  const idKeys = { kajabi_id: "kajabiId", stripe_customer_id: "stripeCustomerId", user_id: "userId" } as const;

  for (const field of ["kajabi_id", "stripe_customer_id", "user_id"] as const) {
    const primaryVal = primary[field];
    const secondaryVal = secondary[field];

    if (!primaryVal && secondaryVal) {
      primaryPatch[field] = secondaryVal;
      idsToFill[idKeys[field]] = secondaryVal;
    } else if (primaryVal && secondaryVal && primaryVal !== secondaryVal) {
      conflicts.push({ field, kept: primaryVal, discarded: secondaryVal });
    }
  }

  try {
    // Transfer simple foreign keys in parallel
    await Promise.all([
      createRepos(supabase).attendance.reassign(secondaryId, primaryId),
      run(supabase.from("member_activities").update({ member_id: primaryId }).eq("member_id", secondaryId)),
      run(supabase.from("member_hiatus_history").update({ member_id: primaryId }).eq("member_id", secondaryId)),
      run(supabase.from("member_status_overrides").update({ member_id: primaryId }).eq("member_id", secondaryId)),
      // prickles.host (not host_id) -- a wrong column name here used to fail silently, and deleting
      // the secondary below then SET NULL'd every prickle they hosted.
      createRepos(supabase).prickles.reassignHost(secondaryId, primaryId),
      // prickle_schedules.host_id is ON DELETE CASCADE, so an untransferred schedule would be
      // silently deleted along with the secondary.
      createRepos(supabase).prickleSchedules.reassignHost(secondaryId, primaryId),
      run(supabase.from("prickle_types").update({ default_host_id: primaryId }).eq("default_host_id", secondaryId)),
      run(supabase.from("ambiguous_zoom_names").update({ resolved_member_id: primaryId }).eq("resolved_member_id", secondaryId)),
    ]);

    // Handle name aliases carefully — alias column is UNIQUE so we can't blindly reassign
    const aliases = createRepos(supabase).aliases;
    const [primaryAliases, secondaryAliases] = await Promise.all([aliases.namesOf(primaryId), aliases.namesOf(secondaryId)]);

    const primaryAliasSet = new Set(primaryAliases.map((a) => a.alias));
    const conflicting = secondaryAliases.filter((a) => primaryAliasSet.has(a.alias));
    const nonConflicting = secondaryAliases.filter((a) => !primaryAliasSet.has(a.alias));

    const aliasOps: Promise<unknown>[] = [];
    if (conflicting.length > 0) aliasOps.push(aliases.removeNames(conflicting.map((a) => a.id)));
    if (nonConflicting.length > 0) aliasOps.push(aliases.moveNames(nonConflicting.map((a) => a.id), primaryId));
    if (secondary.name !== primary.name && !primaryAliasSet.has(secondary.name)) {
      aliasOps.push(aliases.upsertName(primaryId, secondary.name, "zoom"));
    }
    await Promise.all(aliasOps);

    // Handle program-cohort enrollments carefully — (member_id, cohort_id) is UNIQUE,
    // so a secondary enrolled in the same cohort as the primary would collide.
    const [{ data: primaryEnrollments }, { data: secondaryEnrollments }] = await Promise.all([
      supabase.from("member_program_enrollments").select("cohort_id").eq("member_id", primaryId),
      supabase.from("member_program_enrollments").select("id, cohort_id").eq("member_id", secondaryId),
    ]);

    const primaryCohortSet = new Set((primaryEnrollments || []).map((e) => e.cohort_id));
    const conflictingEnrollments = (secondaryEnrollments || []).filter((e) => primaryCohortSet.has(e.cohort_id));
    const nonConflictingEnrollments = (secondaryEnrollments || []).filter((e) => !primaryCohortSet.has(e.cohort_id));

    const enrollmentOps: Promise<unknown>[] = [];
    if (conflictingEnrollments.length > 0) {
      enrollmentOps.push(run(
        supabase.from("member_program_enrollments").delete().in("id", conflictingEnrollments.map((e) => e.id))
      ));
    }
    if (nonConflictingEnrollments.length > 0) {
      enrollmentOps.push(run(
        supabase.from("member_program_enrollments").update({ member_id: primaryId }).in("id", nonConflictingEnrollments.map((e) => e.id))
      ));
    }
    await Promise.all(enrollmentOps);

    // Update ambiguous_zoom_names.candidate_member_ids arrays — Supabase JS can't do
    // in-place array element replacement, so we fetch affected rows and patch each one.
    const { data: ambiguousWithSecondary } = await supabase
      .from("ambiguous_zoom_names")
      .select("id, candidate_member_ids")
      .contains("candidate_member_ids", [secondaryId]);

    if (ambiguousWithSecondary && ambiguousWithSecondary.length > 0) {
      await Promise.all(
        ambiguousWithSecondary.map((row) => {
          const withoutSecondary = (row.candidate_member_ids as string[]).filter(
            (id) => id !== secondaryId
          );
          const newIds = withoutSecondary.includes(primaryId)
            ? withoutSecondary
            : [...withoutSecondary, primaryId];
          return run(
            supabase
              .from("ambiguous_zoom_names")
              .update({ candidate_member_ids: newIds })
              .eq("id", row.id)
          );
        })
      );
    }

    // Email aliases belong to a member (member_id, ON DELETE CASCADE): move the secondary's
    // to the primary, then record the secondary's own email as one of the primary's. Both
    // must land before the delete below.
    await aliases.moveAllEmails(secondaryId, primaryId);
    await aliases.upsertEmail(primaryId, secondary.email.toLowerCase(), "manual");

    // Patch primary with any external IDs it was missing, and clean up derived records that
    // will be recomputed for the primary.
    const patchAndCleanup: Promise<unknown>[] = [
      run(supabase.from("member_metrics").delete().eq("member_id", secondaryId)),
      run(supabase.from("member_engagement").delete().eq("member_id", secondaryId)),
    ];
    if (Object.keys(primaryPatch).length > 0) {
      patchAndCleanup.push(repo.setExternalIds(primaryId, idsToFill));
    }
    await Promise.all(patchAndCleanup);

    await repo.delete(secondaryId);

    return NextResponse.json({
      success: true,
      message: `Merged "${secondary.name}" (${secondary.email}) into "${primary.name}" (${primary.email})`,
      transferred: Object.keys(primaryPatch),
      conflicts,
    });
  } catch (error: unknown) {
    // Supabase errors are plain objects with a message, not Error instances.
    const message = (error as { message?: string } | null)?.message || "Failed to merge members";
    console.error("Error merging members:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
