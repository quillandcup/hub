import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

async function run(query: PromiseLike<unknown>) {
  await query;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { primaryId, secondaryId } = await request.json();

  if (!primaryId || !secondaryId) {
    return NextResponse.json({ error: "primaryId and secondaryId are required" }, { status: 400 });
  }
  if (primaryId === secondaryId) {
    return NextResponse.json({ error: "Cannot merge a member into themselves" }, { status: 400 });
  }

  const [{ data: primary }, { data: secondary }] = await Promise.all([
    supabase.from("members").select("id, name, email, kajabi_id, stripe_customer_id, user_id").eq("id", primaryId).single(),
    supabase.from("members").select("id, name, email, kajabi_id, stripe_customer_id, user_id").eq("id", secondaryId).single(),
  ]);

  if (!primary) return NextResponse.json({ error: "Primary member not found" }, { status: 404 });
  if (!secondary) return NextResponse.json({ error: "Secondary member not found" }, { status: 404 });

  // Track conflicts where both members have different non-null values.
  // The primary always wins — we note discarded secondary values.
  const conflicts: { field: string; kept: string; discarded: string }[] = [];

  // Build a patch to fill in any external IDs the primary is missing from the secondary.
  const primaryPatch: Record<string, string> = {};

  for (const field of ["kajabi_id", "stripe_customer_id", "user_id"] as const) {
    const primaryVal = primary[field];
    const secondaryVal = secondary[field];

    if (!primaryVal && secondaryVal) {
      primaryPatch[field] = secondaryVal;
    } else if (primaryVal && secondaryVal && primaryVal !== secondaryVal) {
      conflicts.push({ field, kept: primaryVal, discarded: secondaryVal });
    }
  }

  try {
    // Transfer simple foreign keys in parallel
    await Promise.all([
      run(supabase.from("prickle_attendance").update({ member_id: primaryId }).eq("member_id", secondaryId)),
      run(supabase.from("member_activities").update({ member_id: primaryId }).eq("member_id", secondaryId)),
      run(supabase.from("member_hiatus_history").update({ member_id: primaryId }).eq("member_id", secondaryId)),
      run(supabase.from("member_status_overrides").update({ member_id: primaryId }).eq("member_id", secondaryId)),
      run(supabase.from("prickles").update({ host_id: primaryId }).eq("host_id", secondaryId)),
      run(supabase.from("prickle_types").update({ default_host_id: primaryId }).eq("default_host_id", secondaryId)),
      run(supabase.from("ambiguous_zoom_names").update({ resolved_member_id: primaryId }).eq("resolved_member_id", secondaryId)),
    ]);

    // Handle name aliases carefully — alias column is UNIQUE so we can't blindly reassign
    const [{ data: primaryAliases }, { data: secondaryAliases }] = await Promise.all([
      supabase.from("member_name_aliases").select("alias").eq("member_id", primaryId),
      supabase.from("member_name_aliases").select("id, alias").eq("member_id", secondaryId),
    ]);

    const primaryAliasSet = new Set((primaryAliases || []).map((a) => a.alias));
    const conflicting = (secondaryAliases || []).filter((a) => primaryAliasSet.has(a.alias));
    const nonConflicting = (secondaryAliases || []).filter((a) => !primaryAliasSet.has(a.alias));

    const aliasOps: Promise<unknown>[] = [];
    if (conflicting.length > 0) {
      aliasOps.push(run(
        supabase.from("member_name_aliases").delete().in("id", conflicting.map((a) => a.id))
      ));
    }
    if (nonConflicting.length > 0) {
      aliasOps.push(run(
        supabase.from("member_name_aliases").update({ member_id: primaryId }).in("id", nonConflicting.map((a) => a.id))
      ));
    }
    if (secondary.name !== primary.name && !primaryAliasSet.has(secondary.name)) {
      aliasOps.push(run(
        supabase.from("member_name_aliases").upsert(
          { member_id: primaryId, alias: secondary.name, source: "zoom" },
          { onConflict: "alias" }
        )
      ));
    }
    await Promise.all(aliasOps);

    // Patch primary with any external IDs it was missing, and record the secondary's email as
    // an alias so future imports still resolve. Also clean up derived records for the secondary.
    const patchAndCleanup: Promise<unknown>[] = [
      run(supabase.from("member_email_aliases").upsert(
        { canonical_email: primary.email, alias_email: secondary.email, source: "manual" },
        { onConflict: "alias_email" }
      )),
      run(supabase.from("member_metrics").delete().eq("member_id", secondaryId)),
      run(supabase.from("member_engagement").delete().eq("member_id", secondaryId)),
    ];
    if (Object.keys(primaryPatch).length > 0) {
      patchAndCleanup.push(run(supabase.from("members").update(primaryPatch).eq("id", primaryId)));
    }
    await Promise.all(patchAndCleanup);

    const { error: deleteError } = await supabase.from("members").delete().eq("id", secondaryId);
    if (deleteError) throw deleteError;

    return NextResponse.json({
      success: true,
      message: `Merged "${secondary.name}" (${secondary.email}) into "${primary.name}" (${primary.email})`,
      transferred: Object.keys(primaryPatch),
      conflicts,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to merge members";
    console.error("Error merging members:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
