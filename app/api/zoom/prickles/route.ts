import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/zoom/prickles?zoomName=<name>
 *
 * Fetch all prickles where a given Zoom name appeared
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const searchParams = request.nextUrl.searchParams;
    const zoomName = searchParams.get("zoomName");

    if (!zoomName) {
      return NextResponse.json(
        { error: "zoomName parameter is required" },
        { status: 400 }
      );
    }

    // Find all zoom_attendees records with this name
    const { data: attendees, error: attendeesError } = await supabase
      .schema('bronze').from("zoom_attendees")
      .select("meeting_uuid")
      .eq("name", zoomName);

    if (attendeesError) {
      console.error("Error fetching attendees:", attendeesError);
      return NextResponse.json({ error: attendeesError.message }, { status: 500 });
    }

    if (!attendees || attendees.length === 0) {
      return NextResponse.json({ prickles: [] });
    }

    // Get unique meeting UUIDs (filter out nulls)
    const meetingUuids = [...new Set(attendees.map(a => a.meeting_uuid).filter(uuid => uuid !== null))];

    console.log(`Found ${attendees.length} attendee records for "${zoomName}"`);
    console.log(`Unique meeting UUIDs: ${meetingUuids.length}`, meetingUuids.slice(0, 3));

    if (meetingUuids.length === 0) {
      console.log(`No valid meeting UUIDs for "${zoomName}"`);
      return NextResponse.json({ prickles: [] });
    }

    // Fetch prickles for these meetings
    const prickles = await createRepos(supabase).prickles.byZoomMeetings(meetingUuids);
    console.log(`Found ${prickles.length} prickles for "${zoomName}"`);

    // Format the response
    const formattedPrickles = prickles.map((p) => ({
      id: p.id,
      start_time: p.startTime,
      end_time: p.endTime,
      type_name: p.type?.name ?? "Unknown",
    }));

    return NextResponse.json({ prickles: formattedPrickles });
  } catch (error: any) {
    console.error("Error in prickles route:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
