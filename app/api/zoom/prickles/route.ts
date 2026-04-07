import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/zoom/prickles?zoomName=<name>
 *
 * Fetch all prickles where a given Zoom name appeared
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      .from("zoom_attendees")
      .select("meeting_uuid")
      .eq("name", zoomName);

    if (attendeesError) {
      console.error("Error fetching attendees:", attendeesError);
      return NextResponse.json({ error: attendeesError.message }, { status: 500 });
    }

    if (!attendees || attendees.length === 0) {
      return NextResponse.json({ prickles: [] });
    }

    // Get unique meeting UUIDs
    const meetingUuids = [...new Set(attendees.map(a => a.meeting_uuid))];

    // Fetch prickles for these meetings
    const { data: prickles, error: pricklesError } = await supabase
      .from("prickles")
      .select(`
        id,
        start_time,
        end_time,
        zoom_meeting_uuid,
        prickle_types (
          name
        )
      `)
      .in("zoom_meeting_uuid", meetingUuids)
      .order("start_time", { ascending: false });

    if (pricklesError) {
      console.error("Error fetching prickles:", pricklesError);
      return NextResponse.json({ error: pricklesError.message }, { status: 500 });
    }

    // Format the response
    const formattedPrickles = prickles?.map((p: any) => ({
      id: p.id,
      start_time: p.start_time,
      end_time: p.end_time,
      type_name: Array.isArray(p.prickle_types)
        ? p.prickle_types[0]?.name
        : p.prickle_types?.name || "Unknown",
    })) || [];

    return NextResponse.json({ prickles: formattedPrickles });
  } catch (error: any) {
    console.error("Error in prickles route:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
