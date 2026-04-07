import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { normalizePrickleType } from "@/lib/prickle-types";

/**
 * Resolve an unmatched calendar event by creating a prickle
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
      unmatchedEventId,
      calendarEventId,
      mode,
      typeId,
      newTypeName,
      host,
      startTime,
      endTime,
    } = body;

    if (!unmatchedEventId || !calendarEventId || !startTime || !endTime) {
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

    // Match host to member ID (host field is a UUID foreign key to members)
    let hostId: string | null = null;

    if (host && host.trim()) {
      // Try to match the host name to a member using the RPC function
      const { data: matchResult } = await supabase.rpc("match_member_by_name", {
        zoom_name: host.trim(),
        zoom_email: null,
      });

      const match = matchResult && matchResult.length > 0 ? matchResult[0] : null;

      if (match) {
        hostId = match.member_id;
      }
      // If no match found, leave hostId as null (allows events without known hosts)
    }

    // Create the prickle
    const { error: prickleError } = await supabase
      .from("prickles")
      .insert({
        type_id: resolvedTypeId,
        host: hostId,
        start_time: startTime,
        end_time: endTime,
        source: "calendar",
      });

    if (prickleError) {
      console.error("Error creating prickle:", prickleError);
      return NextResponse.json(
        { error: "Failed to create prickle" },
        { status: 500 }
      );
    }

    // Mark the unmatched event as resolved
    const { error: updateError } = await supabase
      .from("unmatched_calendar_events")
      .update({
        status: "resolved",
        resolved_type_id: resolvedTypeId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", unmatchedEventId);

    if (updateError) {
      console.error("Error updating unmatched event:", updateError);
      // Don't fail - prickle was created successfully
    }

    return NextResponse.json({
      success: true,
      message: "Prickle created successfully",
    });
  } catch (error: any) {
    console.error("Error resolving event:", error);
    return NextResponse.json(
      { error: error.message || "Failed to resolve event" },
      { status: 500 }
    );
  }
}
