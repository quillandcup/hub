import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { triggerAttendanceReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse, after } from "next/server";

export const maxDuration = 300;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Throws on a Supabase error so a half-finished split is reported, not hidden.
async function run(query: PromiseLike<{ error: unknown }>) {
  const { error } = await query;
  if (error) throw error;
}

/**
 * POST /api/admin/members/split
 *
 * Undo a wrong merge: create a new member out of one that was folded into
 * `memberId`. A merge deletes the absorbed member and leaves their name and
 * email behind as aliases on the survivor, so the split recreates the member
 * and takes those aliases (and the new email) back. Attendance is Silver, so
 * it isn't moved row by row: once the aliases point at the new member, an
 * attendance reprocess over the survivor's history re-files each Zoom row under
 * whoever it matches now.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { memberId, name, email, nameAliasIds, emailAliasIds } = parsed as {
    memberId?: string;
    name?: string;
    email?: string;
    nameAliasIds?: string[];
    emailAliasIds?: string[];
  };

  const newName = typeof name === "string" ? name.trim() : "";
  const newEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!memberId) return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  if (!newName) return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
  if (!EMAIL_RE.test(newEmail)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const nameIds = Array.isArray(nameAliasIds) ? nameAliasIds : [];
  const emailIds = Array.isArray(emailAliasIds) ? emailAliasIds : [];

  const original = await createRepos(supabase).members.byId(memberId);
  if (!original) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  // The new email must be free, or be an alias of the member being split.
  const aliases = createRepos(supabase).aliases;
  const [holder, emailAlias] = await Promise.all([createRepos(supabase).members.byEmail(newEmail), aliases.findEmail(newEmail)]);
  if (holder) {
    return NextResponse.json(
      {
        error:
          holder.id === original.id
            ? "That is this member's own primary email."
            : `${holder.name} already has that email. If they are the new member, move the aliases to them instead of splitting.`,
        conflictingMemberId: holder.id,
        conflictingMemberName: holder.name,
        canMoveAliases: holder.id !== original.id,
      },
      { status: 409 }
    );
  }
  if (emailAlias && emailAlias.memberId !== original.id) {
    return NextResponse.json(
      { error: "That email is already an alias of another member.", conflictingMemberId: emailAlias.memberId },
      { status: 409 }
    );
  }

  // Only aliases that belong to the original member can move.
  const [moveNameIds, emailRows] = await Promise.all([aliases.ownedNameIds(original.id, nameIds), aliases.ownedEmails(original.id, emailIds)]);
  // The new member's own email stops being an alias: it's their email now.
  const moveEmailIds = emailRows.filter((r) => r.alias_email !== newEmail).map((r) => r.id);

  // Oldest attendance of the original member bounds the reprocess.
  const earliestJoinTime = await createRepos(supabase).attendance.firstJoinTime(original.id);

  try {
    if (emailAlias) await aliases.removeEmails([emailAlias.id]);

    // members.source only allows kajabi or staff; the new member is an ordinary (cancelled) contact.
    const createdId = await createRepos(supabase).members.create({
      name: newName,
      email: newEmail,
      joinedAt: new Date().toISOString().split("T")[0],
      status: "cancelled",
      source: "kajabi",
    });
    const created = { id: createdId };

    await aliases.moveNames(moveNameIds, created.id);
    await aliases.moveEmails(moveEmailIds, created.id);

    // Re-file Zoom attendance (all the way back) against the new aliases. Slack
    // activity and members catch up on their next scheduled runs.
    const from = earliestJoinTime ? new Date(earliestJoinTime) : new Date(Date.now() - 90 * 86_400_000);
    after(async () => {
      try {
        await triggerAttendanceReprocessing({ from, to: new Date() });
      } catch (err) {
        console.error("[admin] Reprocessing attendance after a member split failed:", err);
      }
    });

    return NextResponse.json({
      success: true,
      memberId: created.id,
      movedNameAliases: moveNameIds.length,
      movedEmailAliases: moveEmailIds.length,
    });
  } catch (error: unknown) {
    const message = (error as { message?: string } | null)?.message || "Failed to split member";
    console.error("Error splitting member:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
