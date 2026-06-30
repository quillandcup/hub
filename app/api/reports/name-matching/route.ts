import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * Report on name matching issues
 *
 * Returns:
 * - Active members with zero attendance (potential name mismatches)
 * - Unmatched Zoom attendees (names that didn't match to any member)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    // Paginate active members
    const activeMembers: { id: string; name: string; email: string }[] = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .from("members")
          .select("id, name, email")
          .eq("status", "active")
          .order("name")
          .range(offset, offset + 999);
        if (batch && batch.length > 0) {
          activeMembers.push(...batch);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    // Paginate all Zoom attendee records
    const allZoomNames: { name: string; email: string | null }[] = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .schema('bronze').from("zoom_attendees")
          .select("name, email")
          .order("name")
          .range(offset, offset + 999);
        if (batch && batch.length > 0) {
          allZoomNames.push(...batch);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    // Paginate prickle attendance to find all matched member IDs
    const matchedMemberIds = new Set<string>();
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .from("prickle_attendance")
          .select("member_id")
          .range(offset, offset + 999);
        if (batch && batch.length > 0) {
          for (const row of batch) matchedMemberIds.add(row.member_id);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    // Paginate all members (including inactive) for Zoom name matching
    const allMembers: { id: string; name: string; email: string }[] = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .from("members")
          .select("id, name, email")
          .range(offset, offset + 999);
        if (batch && batch.length > 0) {
          allMembers.push(...batch);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    // Filter for members with zero attendance
    const membersWithNoAttendance = activeMembers
      .filter(m => !matchedMemberIds.has(m.id))
      .map(m => ({ id: m.id, name: m.name, email: m.email }));

    // Count how many times each Zoom name appears
    const zoomNameCounts = new Map<string, { count: number; emails: Set<string> }>();
    allZoomNames.forEach(z => {
      const existing = zoomNameCounts.get(z.name);
      if (existing) {
        existing.count++;
        if (z.email) existing.emails.add(z.email);
      } else {
        zoomNameCounts.set(z.name, {
          count: 1,
          emails: new Set(z.email ? [z.email] : []),
        });
      }
    });

    const memberNameMap = new Map(allMembers.map(m => [m.email?.toLowerCase(), m]));

    const unmatchedZoomAttendees: Array<{
      zoomName: string;
      appearances: number;
      emails: string[];
      possibleMatches: Array<{ memberName: string; memberEmail: string }>;
    }> = [];

    // For each unique Zoom name, check if it's unmatched
    for (const [zoomName, info] of zoomNameCounts) {
      // Check if any email in this Zoom name's emails matched to a member
      let hasMatch = false;
      const possibleMatches: Array<{ memberName: string; memberEmail: string }> = [];

      // Check email matches
      for (const email of info.emails) {
        const member = memberNameMap.get(email.toLowerCase());
        if (member && matchedMemberIds.has(member.id)) {
          hasMatch = true;
          break;
        } else if (member && !matchedMemberIds.has(member.id)) {
          // Member exists but has no attendance - this is a possible match issue
          possibleMatches.push({
            memberName: member.name,
            memberEmail: member.email,
          });
        }
      }

      if (!hasMatch && info.count >= 3) { // Only include if they appeared 3+ times
        unmatchedZoomAttendees.push({
          zoomName,
          appearances: info.count,
          emails: Array.from(info.emails),
          possibleMatches,
        });
      }
    }

    // Sort unmatched by appearance count
    unmatchedZoomAttendees.sort((a, b) => b.appearances - a.appearances);

    return NextResponse.json({
      success: true,
      membersWithNoAttendance: {
        count: membersWithNoAttendance.length,
        members: membersWithNoAttendance,
      },
      unmatchedZoomAttendees: {
        count: unmatchedZoomAttendees.length,
        attendees: unmatchedZoomAttendees.slice(0, 50), // Top 50
      },
    });
  } catch (error: any) {
    console.error("Error generating name matching report:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate report" },
      { status: 500 }
    );
  }
}
