import { getMemberDisplayName } from "@/lib/member-display-name";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import type { Db, Update } from "@/lib/data/db";
import { parseEventAudience, parseGuestSpeakers } from "@/lib/event-audience";
import { eventWindow } from "@/lib/event-window";
import type { HubSessionPatch } from "@/lib/data/hub-sessions";
import { EVENT_TYPES, isEventType } from "@/lib/events-filter";
import { eventImageError } from "@/lib/media/event-image";
import { applyPrickleEdits, type EventOverrides, type PrickleEdits } from "@/lib/prickle-edits";
import { loadEventDecision } from "@/lib/prickle-event-decisions";

/** The text fields of a calendar item's prickle that an admin set by hand (nothing for an event made in the Hub). */
async function overridesOf(supabase: Db, calendarEventId: string | null | undefined): Promise<EventOverrides> {
  if (!calendarEventId) return { title: false, description: false, guestSpeaker: false, location: false };
  const decision = await loadEventDecision(supabase, calendarEventId);
  return {
    title: decision.resolved_title !== null,
    description: decision.resolved_description !== null,
    guestSpeaker: decision.resolved_guest_speaker !== null,
    location: decision.resolved_location !== null,
  };
}

const sameText = (a: unknown, b: unknown) => (typeof a === "string" ? a.trim() : "") === (typeof b === "string" ? b.trim() : "");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const repos = createRepos(supabase);
  let event;
  try {
    event = await repos.events.byId(id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load event" }, { status: 404 });
  }
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  let photos, badgeType, attendees;
  try {
    [photos, badgeType, attendees] = await Promise.all([repos.events.allPhotosOf(id), repos.badges.typeForEvent(id), repos.events.attendeesOf(id)]);
  } catch (error) {
    console.error("Error fetching event details:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load event" }, { status: 500 });
  }

  const attendeeRows = attendees.map((a) => ({
    id: a.id,
    memberId: a.member_id,
    memberName: a.member ? getMemberDisplayName(a.member) : "Unknown",
    memberRealName: a.member && getMemberDisplayName(a.member) !== a.member.name ? a.member.name : undefined,
    memberEmail: a.member?.email ?? "",
  }));

  // The prickle the event stands on is where its title, description, host, guest speaker, location and times are
  // edited; for an event made in the Hub (a Hub session) they are edited on the event page itself.
  const prickle = await repos.prickles.byId(event.prickle_id);
  const overridden = await overridesOf(supabase, prickle?.calendarEventId);

  return NextResponse.json({ event, prickleId: event.prickle_id, hubSession: !!prickle?.hubSessionId, overridden, photos, badgeType: badgeType ?? null, attendees: attendeeRows });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { id } = await params;
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const {
      slug,
      title,
      event_type,
      location,
      starts_at,
      ends_at,
      start_clock,
      end_clock,
      host_name,
      host_id,
      focus,
      description,
      agenda,
      results,
      google_photos_album_url,
      image_id,
    } = body;

    if (event_type !== undefined && !isEventType(event_type)) {
      return NextResponse.json({ error: `event_type must be one of: ${EVENT_TYPES.join(", ")}` }, { status: 400 });
    }
    const repos = createRepos(supabase);
    const imageError = await eventImageError(repos.media, image_id);
    if (imageError) return NextResponse.json({ error: imageError }, { status: 400 });
    const current = await repos.events.byId(id);
    if (!current) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const audience = parseEventAudience(body, current);
    if (!audience.ok) return NextResponse.json({ error: audience.error }, { status: 400 });
    const speakers = parseGuestSpeakers(body);
    if (!speakers.ok) return NextResponse.json({ error: speakers.error }, { status: 400 });

    const updates: Update<"community_events"> = { ...audience.fields };
    if (slug !== undefined) updates.slug = slug;
    if (event_type !== undefined) updates.event_type = event_type;
    if (focus !== undefined) updates.focus = focus;
    if (agenda !== undefined) updates.agenda = agenda;
    if (results !== undefined) updates.results = results;
    if (google_photos_album_url !== undefined) updates.google_photos_album_url = google_photos_album_url;
    if (image_id !== undefined) updates.image_id = image_id;

    // The title, description, host, guest speaker, location and times belong to the prickle the event stands on.
    // For an event made in the Hub that prickle is a Hub session (all of them are saved to it). For a calendar item
    // the text, host and guest speaker are saved as the calendar item's decision, by the same function the prickle
    // page uses, so they survive reprocessing and the two pages agree; its times come from Google Calendar and a
    // request that names them is not applied.
    const prickle = await repos.prickles.byId(current.prickle_id);
    if (prickle && !prickle.hubSessionId && prickle.calendarEventId) {
      // Only what differs from what the event shows is passed on (the title shown may be the type's name).
      const edits: PrickleEdits = {};
      if (title !== undefined && !sameText(title, current.title)) edits.title = title;
      if (description !== undefined && !sameText(description, current.description)) edits.description = description;
      if (location !== undefined && !sameText(location, current.location)) edits.location = location;
      if (speakers.value !== undefined && !sameText(speakers.value, current.speakers)) edits.guestSpeaker = speakers.value;
      if (typeof host_id === "string" && host_id && host_id !== current.host_id) edits.hostId = host_id;
      if (Object.keys(edits).length > 0) {
        const saved = await applyPrickleEdits(supabase, prickle.id, edits);
        if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
      }
    }
    if (prickle?.hubSessionId) {
      const patch: HubSessionPatch = {};
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description || null;
      if (location !== undefined) patch.location = location || null;
      if (speakers.value !== undefined) patch.guestSpeaker = speakers.value;
      if (typeof host_id === "string" && host_id) {
        // A member hosts it: their name is shown, so the free-text host goes.
        if (host_id !== current.host_id) {
          patch.hostId = host_id;
          patch.hostName = null;
        }
      } else if (host_name !== undefined && (host_name || null) !== current.host_name) {
        patch.hostName = typeof host_name === "string" && host_name.trim() ? host_name.trim() : null;
        patch.hostId = null;
      }
      if (starts_at !== undefined || ends_at !== undefined) {
        const window = eventWindow({ startDate: starts_at, endDate: ends_at, startClock: start_clock, endClock: end_clock });
        if (!window.ok) return NextResponse.json({ error: window.error }, { status: 400 });
        patch.startTime = window.startTime;
        patch.endTime = window.endTime;
      }
      if (Object.keys(patch).length > 0) await repos.hubSessions.update(prickle.hubSessionId, patch);
    }
    // An admin who has edited an event keeps it: the calendar sync no longer takes it away.
    updates.automatic = false;

    const event = await repos.events.edit(id, updates);

    return NextResponse.json({ event, overridden: await overridesOf(supabase, prickle?.calendarEventId) });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  // Photo rows cascade via the event_photos.event_id FK, but the storage
  // objects don't -- clean those up first so we don't leak blobs.
  const events = createRepos(supabase).events;
  try {
    const paths = await events.photoPaths(id);
    if (paths.length > 0) await supabase.storage.from("event-photos").remove(paths);
    await events.remove(id);
  } catch (error) {
    console.error("Error deleting event:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete event" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
