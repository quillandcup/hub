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
    supabase.from("members").select("id, name, email").eq("id", primaryId).single(),
    supabase.from("members").select("id, name, email").eq("id", secondaryId).single(),
  ]);

  if (!primary) return NextResponse.json({ error: "Primary member not found" }, { status: 404 });
  if (!secondary) return NextResponse.json({ error: "Secondary member not found" }, { status: 404 });

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

    // Record secondary's email as an email alias so future imports still resolve correctly
    await Promise.all([
      run(supabase.from("member_email_aliases").upsert(
        { canonical_email: primary.email, alias_email: secondary.email, source: "manual" },
        { onConflict: "alias_email" }
      )),
      // Remove derived records for secondary (will be recomputed for primary)
      run(supabase.from("member_metrics").delete().eq("member_id", secondaryId)),
      run(supabase.from("member_engagement").delete().eq("member_id", secondaryId)),
    ]);

    const { error: deleteError } = await supabase.from("members").delete().eq("id", secondaryId);
    if (deleteError) throw deleteError;

    return NextResponse.json({
      success: true,
      message: `Merged "${secondary.name}" (${secondary.email}) into "${primary.name}" (${primary.email})`,
    });
  } catch (error: any) {
    console.error("Error merging members:", error);
    return NextResponse.json(
      { error: error.message || "Failed to merge members" },
      { status: 500 }
    );
  }
}
