import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerAttendanceReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse, after } from "next/server";

export const maxDuration = 300;

async function run(query: PromiseLike<{ error: unknown }>) {
  const { error } = await query;
  if (error) throw error;
}

/**
 * POST /api/admin/members/move-aliases
 *
 * Move name and email aliases from one member to another that already exists:
 * the case where a merge folded someone into the wrong member and a later sync
 * has since recreated them from their own Kajabi contact. (Split creates the
 * member when there isn't one.) An email alias that is the target's own primary
 * email is deleted instead of moved, since it's their email now. Attendance is
 * re-filed by reprocessing the source member's history against the new aliases.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { fromMemberId, toMemberId, nameAliasIds, emailAliasIds } = parsed as {
    fromMemberId?: string;
    toMemberId?: string;
    nameAliasIds?: string[];
    emailAliasIds?: string[];
  };

  if (!fromMemberId || !toMemberId) {
    return NextResponse.json({ error: "fromMemberId and toMemberId are required" }, { status: 400 });
  }
  if (fromMemberId === toMemberId) {
    return NextResponse.json({ error: "Pick a different member to move the aliases to" }, { status: 400 });
  }
  const nameIds = Array.isArray(nameAliasIds) ? nameAliasIds : [];
  const emailIds = Array.isArray(emailAliasIds) ? emailAliasIds : [];
  if (nameIds.length === 0 && emailIds.length === 0) {
    return NextResponse.json({ error: "Tick at least one name or email to move" }, { status: 400 });
  }

  const [{ data: from }, { data: to }] = await Promise.all([
    supabase.from("members").select("id").eq("id", fromMemberId).single(),
    supabase.from("members").select("id, email").eq("id", toMemberId).single(),
  ]);
  if (!from) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (!to) return NextResponse.json({ error: "Target member not found" }, { status: 404 });

  // Only aliases that belong to the source member can move.
  const [{ data: nameRows }, { data: emailRows }] = await Promise.all([
    nameIds.length
      ? supabase.from("member_name_aliases").select("id").eq("member_id", from.id).in("id", nameIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
    emailIds.length
      ? supabase.from("member_email_aliases").select("id, alias_email").eq("member_id", from.id).in("id", emailIds)
      : Promise.resolve({ data: [] as { id: string; alias_email: string }[] }),
  ]);
  const moveNameIds = (nameRows ?? []).map((r) => r.id);
  const targetEmail = to.email.toLowerCase();
  const redundantEmailIds = (emailRows ?? []).filter((r) => r.alias_email.toLowerCase() === targetEmail).map((r) => r.id);
  const moveEmailIds = (emailRows ?? []).filter((r) => r.alias_email.toLowerCase() !== targetEmail).map((r) => r.id);

  const { data: earliest } = await supabase
    .from("prickle_attendance")
    .select("join_time")
    .eq("member_id", from.id)
    .order("join_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  try {
    if (redundantEmailIds.length) {
      await run(supabase.from("member_email_aliases").delete().in("id", redundantEmailIds));
    }
    if (moveNameIds.length) {
      await run(supabase.from("member_name_aliases").update({ member_id: to.id }).in("id", moveNameIds));
    }
    if (moveEmailIds.length) {
      await run(supabase.from("member_email_aliases").update({ member_id: to.id }).in("id", moveEmailIds));
    }

    const rangeStart = earliest?.join_time ? new Date(earliest.join_time) : new Date(Date.now() - 90 * 86_400_000);
    after(async () => {
      try {
        await triggerAttendanceReprocessing({ from: rangeStart, to: new Date() });
      } catch (err) {
        console.error("[admin] Reprocessing attendance after moving aliases failed:", err);
      }
    });

    return NextResponse.json({
      success: true,
      movedNameAliases: moveNameIds.length,
      movedEmailAliases: moveEmailIds.length,
      droppedEmailAliases: redundantEmailIds.length,
    });
  } catch (error: unknown) {
    const message = (error as { message?: string } | null)?.message || "Failed to move aliases";
    console.error("Error moving aliases:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
