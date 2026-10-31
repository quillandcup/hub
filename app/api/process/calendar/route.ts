import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { parsePrickleFromSummary, normalizePrickleType, prickleTitleFromSummary, plainTextDescription, assignHostAndSpeaker, typeIdByAlias } from "@/lib/prickle-types";
import { matchAttendeeToMember } from "@/lib/member-matching";
import { calendarTitle, ensureCalendarEvents, hasEventTag, matchTypeId, reconcileAutomaticEvents } from "@/lib/calendar-events";
import { clock } from "@/lib/clock";

// Extend timeout for processing large batches of events
export const maxDuration = 300; // 5 minutes

// Helper to normalize name (simplified version of DB function)
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Process Bronze layer (calendar_events) into Silver layer (prickles)
 *
 * This endpoint:
 * 1. Loads all reference data upfront (members, aliases, prickle_types, existing prickles)
 * 2. Processes events in memory to determine actions
 * 3. Batches database writes for performance
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
    const { fromDate, toDate } = body;

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required" },
        { status: 400 }
      );
    }

    // Normalize date strings to proper datetime boundaries for overlap queries
    // fromDate: use as-is (start of day if date-only)
    // toDate: if date-only, add 1 day to get start of next day
    // This ensures overlap logic catches records that cross boundaries
    const fromDateTime = fromDate.includes('T') ? fromDate : `${fromDate}T00:00:00Z`;
    const toDateTime = toDate.includes('T') ? toDate : (() => {
      const nextDay = new Date(toDate);
      nextDay.setDate(nextDay.getDate() + 1);
      return nextDay.toISOString().split('T')[0] + 'T00:00:00Z';
    })();

    console.log(`Processing calendar events from ${fromDateTime} to ${toDateTime}`);

    // STEP 1a: Fetch all calendar events that overlap the date range
    // Use overlap logic (start < rangeEnd AND end > rangeStart) to catch events
    // that span across date boundaries
    const allEvents = await createRepos(supabase).calendarEvents.overlapping(fromDateTime, toDateTime);

    // STEP 1b: Load all reference data in parallel
    const [
      members,
      aliases,
      loadedTypes,
      resolvedUnmatchedEvents,
    ] = await Promise.all([
      createRepos(supabase).members.identities({ status: "active" }),
      createRepos(supabase).aliases.nameAliases({ activeOnly: true }),
      createRepos(supabase).prickles.types(),
      // Load previously resolved/ignored unmatched events to apply learned decisions
      createRepos(supabase).unmatchedEvents.decisions().catch((decisionsError) => {
        // As before, a failed load doesn't stop the run (the decisions just aren't applied this time).
        console.error("Error loading unmatched event decisions:", decisionsError);
        return [];
      }),
    ]);

    // The shape the matching helpers (matchTypeId) and the loop below read.
    const prickleTypes = loadedTypes.map((t) => ({
      id: t.id,
      name: t.name,
      normalized_name: t.normalizedName,
      default_host_id: t.defaultHostId ?? null,
      summary_aliases: t.summaryAliases ?? [],
      names_guest_speaker: t.namesGuestSpeaker ?? false,
      listed_in_events: t.listedInEvents,
    }));

    if (!allEvents || allEvents.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        pricklesCreated: 0,
      });
    }

    console.log(`Loaded ${allEvents.length} events, ${members.length} members, ${prickleTypes.length} types, ${resolvedUnmatchedEvents?.length || 0} user decisions (resolved/ignored)`);

    // Build lookup maps for fast matching
    const membersByEmail = new Map(
      members.map((m) => [m.email.toLowerCase(), m])
    );
    const membersByNormalizedName = new Map(
      members.map((m) => [normalizeName(m.name), m])
    );
    // Build alias map with lowercase keys for case-insensitive matching
    // Aliases are disambiguation rules and should be flexible
    const aliasToMemberId = new Map(
      aliases?.map((a) => [a.alias.trim().toLowerCase(), a.member_id]) || []
    );
    const typeByNormalizedName = new Map(
      prickleTypes.map((t) => [t.normalized_name, t.id])
    );
    const eventTypeId = typeByNormalizedName.get("event") ?? null;
    // Map calendar_event_id → { status, resolved_type_id, resolved_host_id } for user decisions
    const userDecisionByEventId = new Map(
      resolvedUnmatchedEvents?.map((r) => [r.calendar_event_id, {
        status: r.status,
        typeId: r.resolved_type_id,
        hostId: r.resolved_host_id,
        title: r.resolved_title,
        description: r.resolved_description,
        guestSpeaker: r.resolved_guest_speaker,
        location: r.resolved_location,
      }]) || []
    );

    // STEP 2: Process events in memory
    // Upcoming calendar events that get an event (see ensureCalendarEvents): those of a prickle type listed in
    // Events, and any tagged #event in their Google Calendar description.
    const listedCalendarEventIds = new Set<string>(); // to make an event for: tagged (any time), listed type (upcoming)
    const qualifyingCalendarEventIds = new Set<string>(); // with a reason to have one: tagged, or of a listed type, past or not
    const pricklesToInsert: any[] = [];
    const unmatchedEvents: any[] = [];
    let skippedNoSummary = 0;
    let autoResolvedCount = 0;
    let ignoredCount = 0;

    const now = clock.now();
    for (const event of allEvents) {
      if (hasEventTag(event.description)) {
        listedCalendarEventIds.add(event.id);
        qualifyingCalendarEventIds.add(event.id);
      }
      if (!event.summary) {
        skippedNoSummary++;
        continue;
      }

      // Parse prickle type and host from summary
      const { type: rawType, host: extractedHostName } = parsePrickleFromSummary(event.summary);

      // Match host to member ID
      let hostId: string | null = null;
      let matchedHostName: string | null = null;
      // For unmatched events, suggest the extracted host first (e.g., "Kristin" from "w/Kristin")
      // Fall back to calendar organizer if no host extracted
      let suggestedHostName = extractedHostName || event.creator_name || event.organizer_name || null;

      const hostNameToMatch = extractedHostName; // Only use host from "w/Name" pattern
      // Never use creator/organizer email - they just manage the calendar, not host the events
      const hostEmailToMatch = null;

      if (hostNameToMatch) {
        // Use centralized member matching logic
        // Only match extracted host names (from "w/Name" pattern)
        const match = matchAttendeeToMember(
          hostNameToMatch,
          hostEmailToMatch,
          members,
          aliases || [],
          [],
          true // Skip email matching - we only have the name from event title
        );

        if (match && 'member_id' in match) {
          hostId = match.member_id;
          matchedHostName = members.find((m) => m.id === match.member_id)?.name ?? null;
          // Update suggested name to matched member's name
          const matchedMember = members.find(m => m.id === match.member_id);
          if (matchedMember) {
            suggestedHostName = matchedMember.name;
          }
        }
      }

      // Check if this event was previously resolved/ignored by the user
      // If so, apply that decision automatically (system learns from user)
      let typeId: string | null = null;
      const userDecision = userDecisionByEventId.get(event.id);

      if (userDecision?.status === "ignored") {
        // Event was previously ignored - skip it
        ignoredCount++;
        continue;
      } else if (userDecision?.status === "resolved" && userDecision.typeId) {
        // Event was previously resolved - use that type
        typeId = userDecision.typeId;
        autoResolvedCount++;
      } else {
        // Match to a prickle type by the title's type part, the cleaned title, an alias or a contained name
        typeId = matchTypeId(event.summary, prickleTypes);
      }

      // An item tagged #event that matches no prickle type is still an event: a prickle of the Event type
      // (a retreat), which the event then stands on. Anything else unmatched goes to the review queue.
      if (!typeId && hasEventTag(event.description) && eventTypeId) typeId = eventTypeId;

      if (!typeId) {
        // Type extracted but not in prickle_types table - queue for admin review
        unmatchedEvents.push({
          calendar_event_id: event.id,
          raw_summary: event.summary,
          suggested_type: rawType,
          suggested_host: suggestedHostName,
          status: "pending",
        });
        continue;
      }

      // Add to upsert list — calendar_event_id is the conflict key, so existing prickle UUIDs survive reprocessing
      // Keep the host's own name for the prickle (NULL when it's just "{Type}" / "{Type} Prickle"),
      // without the "w/Host" tail; the calendar description comes along as plain text.
      const matchedType = prickleTypes.find(t => t.id === typeId);
      if (matchedType?.listed_in_events) {
        qualifyingCalendarEventIds.add(event.id);
        if (new Date(event.end_time).getTime() >= now) listedCalendarEventIds.add(event.id);
      }

      // "w/Name" is the host, except for types led by a guest speaker (educational): the type's default host runs those
      const { hostId: finalHostId, guestSpeaker } = assignHostAndSpeaker({
        typedName: extractedHostName,
        memberId: hostId,
        memberName: matchedHostName,
        defaultHostId: matchedType?.default_host_id ?? null,
        namesGuestSpeaker: matchedType?.names_guest_speaker ?? false,
        hostOverrideId: userDecision?.hostId ?? null,
      });

      pricklesToInsert.push({
        calendar_event_id: event.id,
        type_id: typeId,
        // What an admin set by hand (type and host above, text here) wins over what the calendar says.
        title: userDecision?.title ?? (matchedType?.id === eventTypeId ? calendarTitle(event.summary) : matchedType ? prickleTitleFromSummary(event.summary, matchedType.name, matchedType.summary_aliases) : event.summary),
        description: userDecision?.description ?? plainTextDescription(event.description),
        host: finalHostId,
        guest_speaker: userDecision?.guestSpeaker ?? guestSpeaker,
        location: userDecision?.location ?? (event.location?.trim() || null),
        start_time: event.start_time,
        end_time: event.end_time,
        source: "calendar",
      });
    }

    console.log(`Actions: insert ${pricklesToInsert.length}, unmatched ${unmatchedEvents.length}, skipped (no summary) ${skippedNoSummary}`);

    // STEP 3: Atomically reprocess prickles using database function
    // This ensures DELETE + INSERT happens in a single transaction,
    // preventing users from seeing partial state during reprocessing
    console.log(`Atomically reprocessing calendar prickles in date range`);

    const { error: reprocessError } = await supabase.rpc('reprocess_prickles_atomic', {
      from_date: fromDateTime,
      to_date: toDateTime,
      new_data: pricklesToInsert,
    });

    if (reprocessError) {
      console.error("Error atomically reprocessing prickles:", reprocessError);
      throw reprocessError;
    }

    // Delete unmatched events for calendar_events in this date range
    // (This is a separate operation - not part of atomic reprocessing)
    // Batch the deletes to avoid .in() limits with >1000 calendar_event_ids
    const calendarEventIds = allEvents.map(e => e.id);
    if (calendarEventIds.length > 0) {
      try {
        await createRepos(supabase).unmatchedEvents.deletePendingForCalendarEvents(calendarEventIds);
      } catch (deleteError) {
        console.error("Error deleting unmatched events:", deleteError);
        // Don't throw - this is cleanup, not critical
      }
    }

    // STEP 4: Queue unmatched events for admin review
    let queuedForReview = 0;

    // Queue unmatched events in batches
    if (unmatchedEvents.length > 0) {
      try {
        // Chunks of 100 run in parallel inside the repository.
        await createRepos(supabase).unmatchedEvents.queue(unmatchedEvents);
        queuedForReview = unmatchedEvents.length;
      } catch (queueError) {
        // A failed chunk doesn't stop the run (as before); it is only not counted.
        console.error("Error queuing unmatched events:", queueError);
      }
    }

    // STEP 5: Prickles made in the Hub (source hub) are projected from hub_sessions, so reprocessing keeps them.
    await createRepos(supabase).hubSessions.project();

    // STEP 6: Events stand on prickles, so they follow the calendar through them; only new ones need making.
    const eventsCreated = await ensureCalendarEvents(supabase, [...listedCalendarEventIds]);
    // The automatic events whose reason has gone (the tag taken out, the type un-listed, the calendar item deleted)
    // are taken away. The prickle types are loaded above (a failed load stops the run), so every type that is listed counts.
    const eventsRemoved = await reconcileAutomaticEvents(supabase, allEvents.map((e) => e.id), qualifyingCalendarEventIds);

    console.log(`Completed: processed ${pricklesToInsert.length}, queued ${queuedForReview}`);

    return NextResponse.json({
      success: true,
      eventsProcessed: allEvents.length,
      pricklesCreated: pricklesToInsert.length,
      pricklesUpdated: 0, // All are creates now (DELETE + INSERT pattern)
      skippedNoMatch: unmatchedEvents.length,
      skipped: skippedNoSummary,
      autoResolved: autoResolvedCount,
      ignored: ignoredCount,
      eventsCreated,
      eventsRemoved,
    });
  } catch (error: any) {
    console.error("Error processing calendar events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process calendar events" },
      { status: 500 }
    );
  }
}
