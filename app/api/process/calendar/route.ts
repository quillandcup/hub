import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { parsePrickleFromSummary, normalizePrickleType } from "@/lib/prickle-types";

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

// Helper to chunk array for batch processing
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
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
  // Check authentication (supports both cookie-based and service role key)
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  let supabase;

  if (isServiceRole) {
    // Use service role client for tests
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js');
    supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  } else {
    // Use cookie-based client for normal requests
    supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const { fromDate, toDate } = body;

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required" },
        { status: 400 }
      );
    }

    console.log(`Processing calendar events from ${fromDate} to ${toDate}`);

    // STEP 1a: Fetch all calendar events with pagination (Supabase default limit is 1000)
    const FETCH_BATCH_SIZE = 1000;
    let allEvents: any[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error: fetchError } = await supabase
        .from("calendar_events")
        .select("*")
        .gte("start_time", fromDate)
        .lte("end_time", toDate)
        .order("start_time")
        .range(offset, offset + FETCH_BATCH_SIZE - 1);

      if (fetchError) throw fetchError;

      if (batch && batch.length > 0) {
        allEvents = allEvents.concat(batch);
        offset += batch.length;
        hasMore = batch.length === FETCH_BATCH_SIZE;
      } else {
        hasMore = false;
      }
    }

    // STEP 1b: Load all reference data in parallel
    const [
      { data: members },
      { data: aliases },
      { data: prickleTypes },
      { data: resolvedUnmatchedEvents },
    ] = await Promise.all([
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id"),
      supabase.from("prickle_types").select("id, name, normalized_name"),
      // Load previously resolved/ignored unmatched events to apply learned decisions
      supabase
        .from("unmatched_calendar_events")
        .select("calendar_event_id, resolved_type_id, status")
        .in("status", ["resolved", "ignored"]),
    ]);

    if (!allEvents || allEvents.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        pricklesCreated: 0,
      });
    }

    console.log(`Loaded ${allEvents.length} events, ${members?.length || 0} members, ${prickleTypes?.length || 0} types, ${resolvedUnmatchedEvents?.length || 0} user decisions (resolved/ignored)`);

    // Build lookup maps for fast matching
    const membersByEmail = new Map(
      members?.map((m) => [m.email.toLowerCase(), m]) || []
    );
    const membersByNormalizedName = new Map(
      members?.map((m) => [normalizeName(m.name), m]) || []
    );
    // Build alias map with lowercase keys for case-insensitive matching
    // Aliases are disambiguation rules and should be flexible
    const aliasToMemberId = new Map(
      aliases?.map((a) => [a.alias.trim().toLowerCase(), a.member_id]) || []
    );
    const typeByNormalizedName = new Map(
      prickleTypes?.map((t) => [t.normalized_name, t.id]) || []
    );
    // Map calendar_event_id → { status, resolved_type_id } for user decisions
    const userDecisionByEventId = new Map(
      resolvedUnmatchedEvents?.map((r) => [r.calendar_event_id, { status: r.status, typeId: r.resolved_type_id }]) || []
    );

    // STEP 2: Process events in memory
    const pricklesToInsert: any[] = [];
    const unmatchedEvents: any[] = [];
    let skippedNoSummary = 0;
    let autoResolvedCount = 0;
    let ignoredCount = 0;

    for (const event of allEvents) {
      if (!event.summary) {
        skippedNoSummary++;
        continue;
      }

      // Parse prickle type and host from summary
      const { type: rawType, host: extractedHostName } = parsePrickleFromSummary(event.summary);

      // Match host to member ID
      let hostId: string | null = null;
      // For unmatched events, suggest the extracted host first (e.g., "Kristin" from "w/Kristin")
      // Fall back to calendar organizer if no host extracted
      let suggestedHostName = extractedHostName || event.creator_name || event.organizer_name || null;

      const hostNameToMatch = extractedHostName || event.organizer_name || event.creator_name;
      // Only use organizer/creator email if we didn't extract a host from "w/Name" pattern
      // Otherwise we'd match "Prickle w/Lili" to the calendar organizer instead of Lili
      const hostEmailToMatch = extractedHostName ? null : (event.organizer_email || event.creator_email);

      if (hostNameToMatch) {
        // Try email match first
        if (hostEmailToMatch) {
          const member = membersByEmail.get(hostEmailToMatch.toLowerCase());
          if (member) {
            hostId = member.id;
            suggestedHostName = member.name;
          }
        }

        // Try alias match (case-insensitive for flexibility)
        const normalizedForAlias = hostNameToMatch.trim().toLowerCase();
        if (!hostId && aliasToMemberId.has(normalizedForAlias)) {
          const memberId = aliasToMemberId.get(normalizedForAlias)!;
          const member = members?.find((m) => m.id === memberId);
          if (member) {
            hostId = member.id;
            suggestedHostName = member.name;
          }
        }

        // Try normalized name match
        if (!hostId) {
          const normalized = normalizeName(hostNameToMatch);
          const member = membersByNormalizedName.get(normalized);
          if (member) {
            hostId = member.id;
            suggestedHostName = member.name;
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
        // Match to prickle type using normalization
        if (!rawType) {
          // No type extracted - default to Progress Prickle
          typeId = typeByNormalizedName.get("progress") || null;
        } else {
          // Normalize the extracted type and look up by normalized_name
          const normalizedType = normalizePrickleType(rawType);

          // If normalization resulted in empty (e.g., just "Prickle"), default to Progress
          if (!normalizedType || normalizedType === "") {
            typeId = typeByNormalizedName.get("progress") || null;
          } else {
            typeId = typeByNormalizedName.get(normalizedType) || null;
          }

          // If exact match failed, try partial match (e.g., "Midnight Open Table" contains "Open Table")
          if (!typeId && prickleTypes) {
            const summaryLower = event.summary.toLowerCase();
            for (const type of prickleTypes) {
              const typeNameLower = type.name.toLowerCase();
              if (summaryLower.includes(typeNameLower)) {
                typeId = type.id;
                break;
              }
            }
          }
        }
      }

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

      // Add to insert list (we DELETE everything, so all matched events are re-inserted)
      // Only store title if it's different from the type (for "fun names" like "Midnight Crew")
      const matchedType = prickleTypes?.find(t => t.id === typeId);
      const isSameAsType = matchedType &&
        (event.summary === matchedType.name ||
         event.summary === `${matchedType.name} Prickle`);

      pricklesToInsert.push({
        type_id: typeId,
        title: isSameAsType ? null : event.summary, // NULL if just "{Type}" or "{Type} Prickle"
        host: hostId,
        start_time: event.start_time,
        end_time: event.end_time,
        source: "calendar",
      });
    }

    console.log(`Actions: insert ${pricklesToInsert.length}, unmatched ${unmatchedEvents.length}, skipped (no summary) ${skippedNoSummary}`);

    // STEP 3: DELETE existing data in date range (for reprocessability)
    // This makes the process fully reprocessable - we regenerate Silver from Bronze
    console.log(`Deleting existing calendar prickles and unmatched events in date range`);

    // Delete calendar prickles
    const { error: deletePricklesError } = await supabase
      .from("prickles")
      .delete()
      .eq("source", "calendar")
      .gte("start_time", fromDate)
      .lte("end_time", toDate);

    if (deletePricklesError) {
      console.error("Error deleting existing prickles:", deletePricklesError);
      throw deletePricklesError;
    }

    // Delete unmatched events for calendar_events in this date range
    // Batch the deletes to avoid .in() limits with >1000 calendar_event_ids
    const calendarEventIds = allEvents.map(e => e.id);
    if (calendarEventIds.length > 0) {
      const DELETE_BATCH = 500;
      for (let i = 0; i < calendarEventIds.length; i += DELETE_BATCH) {
        const batch = calendarEventIds.slice(i, i + DELETE_BATCH);
        const { error: deleteError } = await supabase
          .from("unmatched_calendar_events")
          .delete()
          .in("calendar_event_id", batch);

        if (deleteError) {
          console.error("Error deleting unmatched events batch:", deleteError);
          // Don't throw - this is cleanup, not critical
        }
      }
    }

    // STEP 4: Batch INSERT all prickles
    // Since we deleted everything, we insert fresh from Bronze
    const CHUNK_SIZE = 100;
    let created = 0;
    let queuedForReview = 0;

    // Insert all prickles in batches
    if (pricklesToInsert.length > 0) {
      const insertChunks = chunk(pricklesToInsert, CHUNK_SIZE);
      const insertResults = await Promise.all(
        insertChunks.map((batch) =>
          supabase.from("prickles").insert(batch)
        )
      );

      // Log any errors
      const failedChunks = insertResults.filter((r) => r.error);
      if (failedChunks.length > 0) {
        console.error(`Failed to insert ${failedChunks.length} chunks:`, failedChunks[0].error);
      }

      created = insertResults.filter((r) => !r.error).length * CHUNK_SIZE;
      // Adjust for last chunk
      const lastChunkResult = insertResults[insertResults.length - 1];
      if (!lastChunkResult.error) {
        created = created - CHUNK_SIZE + (pricklesToInsert.length % CHUNK_SIZE || CHUNK_SIZE);
      }
    }

    // Queue unmatched events in batches
    if (unmatchedEvents.length > 0) {
      const unmatchedChunks = chunk(unmatchedEvents, CHUNK_SIZE);
      const unmatchedResults = await Promise.all(
        unmatchedChunks.map((batch) =>
          supabase.from("unmatched_calendar_events").upsert(batch, {
            onConflict: "calendar_event_id",
          })
        )
      );
      queuedForReview = unmatchedResults.filter((r) => !r.error).length * CHUNK_SIZE;
      // Adjust for last chunk
      const lastChunkResult = unmatchedResults[unmatchedResults.length - 1];
      if (!lastChunkResult.error) {
        queuedForReview = queuedForReview - CHUNK_SIZE + (unmatchedEvents.length % CHUNK_SIZE || CHUNK_SIZE);
      }
    }

    console.log(`Completed: processed ${created}, queued ${queuedForReview}`);

    return NextResponse.json({
      success: true,
      eventsProcessed: allEvents.length,
      pricklesCreated: created,
      pricklesUpdated: 0, // All are creates now (DELETE + INSERT pattern)
      skippedNoMatch: unmatchedEvents.length,
      skipped: skippedNoSummary,
      autoResolved: autoResolvedCount,
      ignored: ignoredCount,
    });
  } catch (error: any) {
    console.error("Error processing calendar events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process calendar events" },
      { status: 500 }
    );
  }
}
