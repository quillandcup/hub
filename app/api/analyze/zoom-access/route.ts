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
 * Zoom attendees from the last 90 days who either:
 *   - matched to an inactive member (attending after cancellation)
 *   - didn't match any member record (potential non-member)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const cutoff = NINETY_DAYS_AGO();

  try {
    const [
      { data: members },
      { data: nameAliases },
      { data: emailAliases },
      { data: ignoredNames },
    ] = await Promise.all([
      supabase.from("members").select("id, name, email, status"),
      supabase.from("member_name_aliases").select("alias, member_id, source"),
      supabase.from("member_email_aliases").select("alias_email, canonical_email"),
      supabase.from("ignored_zoom_names").select("name"),
    ]);

    const ignoredNameSet = new Set(
      (ignoredNames ?? []).map((r) => r.name.toLowerCase())
    );
    const memberStatusMap = new Map(
      (members ?? []).map((m) => [m.id, m.status as string])
    );
    const zoomAliases = (nameAliases ?? []).filter((a) => a.source === "zoom");
    const memberList = (members ?? []).map((m) => ({ id: m.id, name: m.name, email: m.email }));

    // Paginate zoom_attendees for the last 90 days
    const attendees: Array<{ name: string; email: string | null; meeting_uuid: string }> = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .schema("bronze")
          .from("zoom_attendees")
          .select("name, email, meeting_uuid")
          .gte("join_time", cutoff)
          .range(offset, offset + 999);
        if (batch && batch.length > 0) {
          attendees.push(...batch);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    // Group by name for matching efficiency, preserving meeting_uuids
    const inactiveMatchCounts = new Map<string, { member_id: string; member_name: string; meetings: Set<string> }>();
    const unmatchedCounts = new Map<string, Set<string>>();

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
        if (status === "inactive") {
          if (!inactiveMatchCounts.has(result.member_id)) {
            const member = (members ?? []).find((m) => m.id === result.member_id);
            inactiveMatchCounts.set(result.member_id, {
              member_id: result.member_id,
              member_name: member?.name ?? result.member_id,
              meetings: new Set(),
            });
          }
          inactiveMatchCounts.get(result.member_id)!.meetings.add(attendee.meeting_uuid);
        }
      } else {
        // Unmatched or ambiguous — treat as unmatched
        if (ignoredNameSet.has(attendee.name.toLowerCase())) continue;
        if (!unmatchedCounts.has(attendee.name)) {
          unmatchedCounts.set(attendee.name, new Set());
        }
        unmatchedCounts.get(attendee.name)!.add(attendee.meeting_uuid);
      }
    }

    const matchedInactive = Array.from(inactiveMatchCounts.values())
      .map((r) => ({
        member_id: r.member_id,
        member_name: r.member_name,
        member_status: "inactive",
        prickle_count: r.meetings.size,
      }))
      .sort((a, b) => b.prickle_count - a.prickle_count);

    const unmatchedList = Array.from(unmatchedCounts.entries())
      .map(([name, meetings]) => ({ name, prickle_count: meetings.size }))
      .sort((a, b) => b.prickle_count - a.prickle_count);

    return NextResponse.json({
      matched_inactive: matchedInactive,
      unmatched: unmatchedList,
    });
  } catch (error: any) {
    console.error("Error analyzing Zoom access:", error);
    return NextResponse.json(
      { error: error.message || "Failed to analyze Zoom access" },
      { status: 500 }
    );
  }
}
