import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
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

  const members = createRepos(supabase).members;
  const [from, to] = await Promise.all([members.byId(fromMemberId), members.byId(toMemberId)]);
  if (!from) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (!to) return NextResponse.json({ error: "Target member not found" }, { status: 404 });

  // Only aliases that belong to the source member can move.
  const aliases = createRepos(supabase).aliases;
  const [moveNameIds, emailRows] = await Promise.all([aliases.ownedNameIds(from.id, nameIds), aliases.ownedEmails(from.id, emailIds)]);
  const targetEmail = to.email.toLowerCase();
  const redundantEmailIds = emailRows.filter((r) => r.alias_email.toLowerCase() === targetEmail).map((r) => r.id);
  const moveEmailIds = emailRows.filter((r) => r.alias_email.toLowerCase() !== targetEmail).map((r) => r.id);

  const earliestJoinTime = await createRepos(supabase).attendance.firstJoinTime(from.id);

  try {
    await aliases.removeEmails(redundantEmailIds);
    await aliases.moveNames(moveNameIds, to.id);
    await aliases.moveEmails(moveEmailIds, to.id);

    const rangeStart = earliestJoinTime ? new Date(earliestJoinTime) : new Date(Date.now() - 90 * 86_400_000);
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
