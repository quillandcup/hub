import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { normalizePrickleType, plainTextDescription, prickleTitleFromSummary } from "@/lib/prickle-types";
import { matchAttendeeToMember } from "@/lib/member-matching";

/**
 * Resolve an unmatched calendar event by creating a prickle
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
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

    // If creating a new type, reuse the one with the same normalized name or add it
    if (mode === "new" && newTypeName) {
      try {
        resolvedTypeId = await createRepos(supabase).prickles.findOrCreateType({
          name: newTypeName.trim(),
          normalizedName: normalizePrickleType(newTypeName),
        });
      } catch (err) {
        console.error("Error creating prickle type:", err);
        return NextResponse.json({ error: "Failed to create prickle type" }, { status: 500 });
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
      // Load members and aliases for matching
      const [members, aliases] = await Promise.all([
        createRepos(supabase).members.identities({ status: "active" }),
        createRepos(supabase).aliases.nameAliases({ activeOnly: true }),
      ]);

      // Try to match the host name to a member using centralized matching
      const match = matchAttendeeToMember(
        host.trim(),
        null,
        members,
        aliases || []
      );

      if (match && 'member_id' in match) {
        hostId = match.member_id;
      }
      // If no match found, leave hostId as null (allows events without known hosts)
    }

    // Create the prickle
    try {
      const repos = createRepos(supabase);
      const [event, resolvedType] = await Promise.all([repos.calendarEvents.byId(calendarEventId), repos.prickles.typeById(resolvedTypeId)]);
      await repos.prickles.createCalendarPrickles([{
        typeId: resolvedTypeId,
        hostId,
        calendarEventId,
        title: event?.summary && resolvedType ? prickleTitleFromSummary(event.summary, resolvedType.name, resolvedType.summaryAliases) : null,
        description: plainTextDescription(event?.description),
        startTime,
        endTime,
      }]);
    } catch (err) {
      console.error("Error creating prickle:", err);
      return NextResponse.json({ error: "Failed to create prickle" }, { status: 500 });
    }

    // Mark the unmatched event as resolved
    try {
      await createRepos(supabase).unmatchedEvents.markResolved([unmatchedEventId], resolvedTypeId, new Date().toISOString());
    } catch (updateError) {
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
