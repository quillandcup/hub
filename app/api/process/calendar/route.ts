import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { parsePrickleFromSummary } from "@/lib/prickle-types";

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
      { data: existingPrickles },
    ] = await Promise.all([
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id"),
      supabase.from("prickle_types").select("id, name"),
      supabase
        .from("prickles")
        .select("id, start_time, end_time, host, type_id")
        .eq("source", "calendar")
        .gte("start_time", fromDate)
        .lte("end_time", toDate),
    ]);

    if (!allEvents || allEvents.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        pricklesCreated: 0,
      });
    }

    console.log(`Loaded ${allEvents.length} events, ${members?.length || 0} members, ${prickleTypes?.length || 0} types`);

    // Build lookup maps for fast matching
    const membersByEmail = new Map(
      members?.map((m) => [m.email.toLowerCase(), m]) || []
    );
    const membersByNormalizedName = new Map(
      members?.map((m) => [normalizeName(m.name), m]) || []
    );
    const aliasToMemberId = new Map(
      aliases?.map((a) => [a.alias, a.member_id]) || []
    );
    const typeByName = new Map(
      prickleTypes?.map((t) => [t.name.toLowerCase(), t.id]) || []
    );
    const existingPrickleKey = (start: string, end: string) => `${start}|${end}`;
    const existingPricklesMap = new Map(
      existingPrickles?.map((p) => [existingPrickleKey(p.start_time, p.end_time), p]) || []
    );

    // STEP 2: Process events in memory
    const pricklesToInsert: any[] = [];
    const pricklesToUpdate: any[] = [];
    const unmatchedEvents: any[] = [];
    let skipped = 0;

    for (const event of allEvents) {
      if (!event.summary) {
        skipped++;
        continue;
      }

      // Parse prickle type and host from summary
      const { type: rawType, host: extractedHostName } = parsePrickleFromSummary(event.summary);

      // Match host to member ID
      let hostId: string | null = null;
      let suggestedHostName = event.creator_name || event.organizer_name || null;

      const hostNameToMatch = extractedHostName || event.organizer_name || event.creator_name;
      const hostEmailToMatch = event.organizer_email || event.creator_email;

      if (hostNameToMatch) {
        // Try email match first
        if (hostEmailToMatch) {
          const member = membersByEmail.get(hostEmailToMatch.toLowerCase());
          if (member) {
            hostId = member.id;
            suggestedHostName = member.name;
          }
        }

        // Try alias match
        if (!hostId && aliasToMemberId.has(hostNameToMatch)) {
          const memberId = aliasToMemberId.get(hostNameToMatch)!;
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

      // Match to prickle type
      if (!rawType) {
        // No type could be extracted - queue for admin review
        unmatchedEvents.push({
          calendar_event_id: event.id,
          raw_summary: event.summary,
          suggested_type: null,
          suggested_host: suggestedHostName,
          status: "pending",
        });
        continue;
      }

      const typeId = typeByName.get(rawType.toLowerCase());

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

      // Check if prickle already exists
      const key = existingPrickleKey(event.start_time, event.end_time);
      const existingPrickle = existingPricklesMap.get(key);

      if (existingPrickle) {
        // Update if host or type changed
        if (existingPrickle.host !== hostId || existingPrickle.type_id !== typeId) {
          pricklesToUpdate.push({
            id: existingPrickle.id,
            host: hostId,
            type_id: typeId,
          });
        } else {
          skipped++;
        }
      } else {
        // Create new prickle
        pricklesToInsert.push({
          type_id: typeId,
          host: hostId,
          start_time: event.start_time,
          end_time: event.end_time,
          source: "calendar",
        });
      }
    }

    console.log(`Actions: insert ${pricklesToInsert.length}, update ${pricklesToUpdate.length}, unmatched ${unmatchedEvents.length}, skipped ${skipped}`);

    // STEP 3: DELETE existing calendar prickles in date range (for reprocessability)
    // This makes the process fully reprocessable - we regenerate Silver from Bronze
    console.log(`Deleting existing calendar prickles in date range`);
    const { error: deleteError } = await supabase
      .from("prickles")
      .delete()
      .eq("source", "calendar")
      .gte("start_time", fromDate)
      .lte("end_time", toDate);

    if (deleteError) {
      console.error("Error deleting existing prickles:", deleteError);
      throw deleteError;
    }

    // STEP 4: Batch INSERT all prickles (both new and previously existing)
    // Since we deleted everything, we insert fresh from Bronze
    const CHUNK_SIZE = 100;
    let created = 0;
    let updated = 0;
    let queuedForReview = 0;

    // Combine insert and update lists - all become inserts after DELETE
    const allPrickles = [...pricklesToInsert];
    for (const p of pricklesToUpdate) {
      const existingPrickle = existingPrickles?.find(ep => ep.id === p.id);
      if (existingPrickle) {
        allPrickles.push({
          type_id: p.type_id,
          host: p.host,
          start_time: existingPrickle.start_time,
          end_time: existingPrickle.end_time,
          source: "calendar",
        });
      }
    }

    // Insert all prickles in batches
    if (allPrickles.length > 0) {
      const insertChunks = chunk(allPrickles, CHUNK_SIZE);
      const insertResults = await Promise.all(
        insertChunks.map((batch) =>
          supabase.from("prickles").insert(batch)
        )
      );
      created = insertResults.filter((r) => !r.error).length * CHUNK_SIZE;
      // Adjust for last chunk
      const lastChunkResult = insertResults[insertResults.length - 1];
      if (!lastChunkResult.error) {
        created = created - CHUNK_SIZE + (allPrickles.length % CHUNK_SIZE || CHUNK_SIZE);
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
      skipped,
    });
  } catch (error: any) {
    console.error("Error processing calendar events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process calendar events" },
      { status: 500 }
    );
  }
}
