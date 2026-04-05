import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { normalizePrickleType } from "@/lib/prickle-types";

/**
 * Resolve multiple unmatched calendar events by creating prickles for all
 * (applies same type/host to all events with the same summary)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      unmatchedEventIds,
      calendarEventIds,
      mode,
      typeId,
      newTypeName,
      host,
    } = body;

    if (!unmatchedEventIds?.length || !calendarEventIds?.length) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    let resolvedTypeId = typeId;

    // If creating a new type, insert it first
    if (mode === "new" && newTypeName) {
      const normalized = normalizePrickleType(newTypeName);

      // Check if type already exists
      const { data: existingType } = await supabase
        .from("prickle_types")
        .select("id")
        .eq("normalized_name", normalized)
        .single();

      if (existingType) {
        resolvedTypeId = existingType.id;
      } else {
        // Create new type
        const { data: newType, error: typeError } = await supabase
          .from("prickle_types")
          .insert({
            name: newTypeName.trim(),
            normalized_name: normalized,
          })
          .select("id")
          .single();

        if (typeError || !newType) {
          return NextResponse.json(
            { error: "Failed to create prickle type" },
            { status: 500 }
          );
        }

        resolvedTypeId = newType.id;
      }
    }

    if (!resolvedTypeId) {
      return NextResponse.json(
        { error: "No prickle type specified" },
        { status: 400 }
      );
    }

    // Validate and match host to a member
    let canonicalHost: string | null = host?.trim() || null;

    // Only try to match if a host was provided
    if (canonicalHost) {
      // Try to match the host to a member to get canonical name
      const { data: matchResult } = await supabase.rpc("match_member_by_name", {
        zoom_name: canonicalHost,
        zoom_email: null,
      });

      const match = matchResult && matchResult.length > 0 ? matchResult[0] : null;

      if (match) {
        // Get the canonical member name
        const { data: member } = await supabase
          .from("members")
          .select("name")
          .eq("id", match.member_id)
          .single();

        if (member) {
          canonicalHost = member.name;
        }
      }
      // If no match found, use the provided host name as-is (allows non-member hosts)
    }

    // Fetch calendar event details for each event
    const { data: calendarEvents } = await supabase
      .from("calendar_events")
      .select("id, start_time, end_time")
      .in("id", calendarEventIds);

    if (!calendarEvents || calendarEvents.length === 0) {
      return NextResponse.json(
        { error: "No calendar events found" },
        { status: 404 }
      );
    }

    // Create prickles for all events
    const pricklesToInsert = calendarEvents.map((event: any) => ({
      type_id: resolvedTypeId,
      host: canonicalHost,
      start_time: event.start_time,
      end_time: event.end_time,
      source: "calendar",
    }));

    const { error: prickleError } = await supabase
      .from("prickles")
      .insert(pricklesToInsert);

    if (prickleError) {
      console.error("Error creating prickles:", prickleError);
      return NextResponse.json(
        { error: "Failed to create prickles" },
        { status: 500 }
      );
    }

    // Mark all unmatched events as resolved
    const { error: updateError } = await supabase
      .from("unmatched_calendar_events")
      .update({
        status: "resolved",
        resolved_type_id: resolvedTypeId,
        resolved_at: new Date().toISOString(),
      })
      .in("id", unmatchedEventIds);

    if (updateError) {
      console.error("Error updating unmatched events:", updateError);
      // Don't fail - prickles were created successfully
    }

    return NextResponse.json({
      success: true,
      message: `Created ${pricklesToInsert.length} prickle(s) successfully`,
      count: pricklesToInsert.length,
    });
  } catch (error: any) {
    console.error("Error resolving events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to resolve events" },
      { status: 500 }
    );
  }
}
