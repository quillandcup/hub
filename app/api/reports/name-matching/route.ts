import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Report on name matching issues
 *
 * Returns:
 * - Active members with zero attendance (potential name mismatches)
 * - Unmatched Zoom attendees (names that didn't match to any member)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get active members with their attendance count
    const { data: activeMembers } = await supabase
      .from("members")
      .select(`
        id,
        name,
        email,
        attendance(id)
      `)
      .eq("status", "active")
      .order("name");

    // Filter for members with zero attendance
    const membersWithNoAttendance = activeMembers
      ?.filter(m => !m.attendance || m.attendance.length === 0)
      .map(m => ({
        id: m.id,
        name: m.name,
        email: m.email,
      })) || [];

    // Get unmatched Zoom attendees (names that appear in zoom_attendees but not in attendance)
    // First, get all distinct Zoom attendee names
    const { data: allZoomNames } = await supabase
      .from("zoom_attendees")
      .select("name, email")
      .order("name");

    // Get all matched names from attendance table
    const { data: matchedAttendance } = await supabase
      .from("attendance")
      .select(`
        id,
        member_id,
        members!inner(name)
      `);

    // Count how many times each Zoom name appears
    const zoomNameCounts = new Map<string, { count: number; emails: Set<string> }>();
    allZoomNames?.forEach(z => {
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

    // Get matched member IDs
    const matchedMemberIds = new Set(matchedAttendance?.map(a => a.member_id) || []);

    // Find Zoom names that have NO matches in attendance table
    // This is done by checking if the Zoom attendee's name appears in our member list but has zero attendance
    const { data: allMembers } = await supabase
      .from("members")
      .select("id, name, email");

    const memberNameMap = new Map(allMembers?.map(m => [m.email?.toLowerCase(), m]) || []);

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
