import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { matchAttendeeToMember } from "@/lib/member-matching";
import { NextRequest, NextResponse } from "next/server";

const NINETY_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString();
};

/**
 * GET /api/analyze/zoom-access
 * Zoom attendees from the last 90 days who matched to a cancelled member
 * (attending after cancellation) — a subscription-status signal. Attendees
 * who didn't match any member record at all are covered (all-time) by
 * /admin/hygiene/unmatched-zoom, not duplicated here.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const cutoff = NINETY_DAYS_AGO();

  try {
    const [
      members,
      nameAliases,
      emailAliases,
    ] = await Promise.all([
      createRepos(supabase).members.list(),
      createRepos(supabase).aliases.nameAliases(),
      createRepos(supabase).aliases.emailAliases(),
    ]);

    const memberStatusMap = new Map(
      members.map((m) => [m.id, m.status])
    );
    const zoomAliases = (nameAliases ?? []).filter((a) => a.source === "zoom");
    const memberList = members.map((m) => ({ id: m.id, name: m.name, email: m.email }));

    // zoom_attendees for the last 90 days (the repository pages through them)
    const attendees = await createRepos(supabase).zoom.attendeesSince(cutoff);

    // Group by name for matching efficiency, preserving meeting_uuids
    const inactiveMatchCounts = new Map<string, { member_id: string; member_name: string; member_display_name: string | null; meetings: Set<string> }>();

    for (const attendee of attendees) {
      const result = matchAttendeeToMember(
        attendee.name,
        attendee.email,
        memberList,
        zoomAliases,
        emailAliases ?? []
      );

      if (result && "member_id" in result) {
        const status = memberStatusMap.get(result.member_id);
        if (status === "cancelled") {
          if (!inactiveMatchCounts.has(result.member_id)) {
            const member = (members ?? []).find((m) => m.id === result.member_id);
            inactiveMatchCounts.set(result.member_id, {
              member_id: result.member_id,
              member_name: member?.name ?? result.member_id,
              member_display_name: member?.displayName ?? null,
              meetings: new Set(),
            });
          }
          if (attendee.meeting_uuid) inactiveMatchCounts.get(result.member_id)!.meetings.add(attendee.meeting_uuid);
        }
      }
    }

    const matchedInactive = Array.from(inactiveMatchCounts.values())
      .map((r) => ({
        member_id: r.member_id,
        member_name: r.member_name,
        member_display_name: r.member_display_name,
        member_status: "cancelled",
        prickle_count: r.meetings.size,
      }))
      .sort((a, b) => b.prickle_count - a.prickle_count);

    return NextResponse.json({
      matched_inactive: matchedInactive,
    });
  } catch (error: any) {
    console.error("Error analyzing Zoom access:", error);
    return NextResponse.json(
      { error: error.message || "Failed to analyze Zoom access" },
      { status: 500 }
    );
  }
}
