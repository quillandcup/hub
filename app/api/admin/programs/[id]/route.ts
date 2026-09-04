import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export interface LeakageRow {
  member_id: string;
  member_name: string;
  member_email: string;
  member_status: string;
  cohort_name: string;
  expired_at: string;
  days_since_expiry: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const [{ data: program, error: programError }, { data: cohorts, error: cohortsError }] = await Promise.all([
    supabase.from("programs").select("*").eq("id", id).single(),
    supabase
      .from("program_cohorts")
      .select(`
        *,
        member_program_enrollments(
          id, notes, created_at,
          member:members(id, name, email, status)
        )
      `)
      .eq("program_id", id)
      .order("starts_at", { ascending: false }),
  ]);

  if (programError) return NextResponse.json({ error: programError.message }, { status: 404 });
  if (cohortsError) {
    console.error("Error fetching cohorts:", cohortsError);
    return NextResponse.json({ error: cohortsError.message }, { status: 500 });
  }

  const today = new Date();
  const todayMs = new Date(today.toISOString().split("T")[0] + "T00:00:00Z").getTime();
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  // A member's latest expiry and whether any of their enrollments in this
  // program is currently active, across all of the program's cohorts —
  // an alumna re-enrolled in a newer cohort should not show up as lapsed.
  const latestExpiryByMember = new Map<string, { expiresAt: string; cohortName: string }>();
  const activeMemberIds = new Set<string>();
  const memberInfo = new Map<string, { name: string; email: string; status: string }>();

  for (const cohort of cohorts || []) {
    const isActive = todayMs >= new Date(cohort.starts_at).getTime() && todayMs <= new Date(cohort.expires_at).getTime();
    for (const enrollment of cohort.member_program_enrollments || []) {
      const member = enrollment.member;
      if (!member) continue;
      memberInfo.set(member.id, { name: member.name, email: member.email, status: member.status });
      if (isActive) activeMemberIds.add(member.id);

      const existing = latestExpiryByMember.get(member.id);
      if (!existing || new Date(cohort.expires_at).getTime() > new Date(existing.expiresAt).getTime()) {
        latestExpiryByMember.set(member.id, { expiresAt: cohort.expires_at, cohortName: cohort.name });
      }
    }
  }

  const leakage: LeakageRow[] = [];
  for (const [memberId, { expiresAt, cohortName }] of latestExpiryByMember) {
    if (activeMemberIds.has(memberId)) continue;
    if (new Date(expiresAt).getTime() >= todayMs) continue;
    const info = memberInfo.get(memberId)!;
    if (info.status === "active") continue;
    leakage.push({
      member_id: memberId,
      member_name: info.name,
      member_email: info.email,
      member_status: info.status,
      cohort_name: cohortName,
      expired_at: expiresAt,
      days_since_expiry: Math.floor((todayMs - new Date(expiresAt).getTime()) / MS_PER_DAY),
    });
  }
  leakage.sort((a, b) => b.days_since_expiry - a.days_since_expiry);

  return NextResponse.json({ program, cohorts, leakage });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { name, slug, description, kajabi_offer_names } = body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug;
    if (description !== undefined) updates.description = description;
    if (kajabi_offer_names !== undefined) updates.kajabi_offer_names = kajabi_offer_names;

    const { data: program, error } = await supabase
      .from("programs")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("Error updating program:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ program });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to update program" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const { error } = await supabase.from("programs").delete().eq("id", id);
  if (error) {
    console.error("Error deleting program:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
