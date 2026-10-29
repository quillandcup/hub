import { getMemberDisplayName } from "@/lib/member-display-name";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import type { Update } from "@/lib/data/db";
import { parseEventAudience } from "@/lib/event-audience";
import { calendarEventFields, overridesAfterEdit } from "@/lib/calendar-events";
import { EVENT_TYPES, isEventType } from "@/lib/events-filter";
import { isId } from "@/lib/ids";

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

  // The prickle this event stands for, when it has one: it is the source of the event's title, description, guest speaker and host.
  const [prickle] = event.calendar_event_id ? await repos.prickles.byCalendarEventIds([event.calendar_event_id]) : [];

  return NextResponse.json({ event, prickleId: prickle?.id ?? null, photos, badgeType: badgeType ?? null, attendees: attendeeRows });
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
    if (image_id !== undefined && image_id !== null && !isId(image_id, "media")) {
      return NextResponse.json({ error: "image_id must be a media library id, or null" }, { status: 400 });
    }
    const repos = createRepos(supabase);
    if (typeof image_id === "string") {
      const asset = await repos.media.byId(image_id).catch(() => null);
      if (!asset || asset.deleted_at) return NextResponse.json({ error: "That image isn't in the media library" }, { status: 400 });
    }
    const current = await repos.events.byId(id);
    const audience = parseEventAudience(body, current ?? undefined);
    if (!audience.ok) return NextResponse.json({ error: audience.error }, { status: 400 });

    const updates: Update<"events"> = { ...audience.fields };

    // An event that follows the calendar: the calendar owns its dates and times, and a changed
    // title, description or location is remembered as an override so the next sync keeps it.
    const followsCalendar = !!current?.calendar_event_id;
    // An event that stands for a prickle takes its title, description, guest speaker and host from it: those are
    // edited on the prickle, so an update here leaves them alone.
    const [prickle] = current?.calendar_event_id ? await repos.prickles.byCalendarEventIds([current.calendar_event_id]) : [];
    const fromPrickle = !!prickle;
    if (slug !== undefined) updates.slug = slug;
    if (title !== undefined && !fromPrickle) updates.title = title;
    if (event_type !== undefined) updates.event_type = event_type;
    if (location !== undefined) updates.location = location;
    if (starts_at !== undefined && !followsCalendar) updates.starts_at = starts_at;
    if (ends_at !== undefined && !followsCalendar) updates.ends_at = ends_at;
    if (focus !== undefined) updates.focus = focus;
    if (description !== undefined && !fromPrickle) updates.description = description;
    if (agenda !== undefined) updates.agenda = agenda;
    if (results !== undefined) updates.results = results;
    if (google_photos_album_url !== undefined) updates.google_photos_album_url = google_photos_album_url;
    if (image_id !== undefined) updates.image_id = image_id;

    if (current && followsCalendar) {
      const { overridden, follow } = overridesAfterEdit(current, fromPrickle ? { location } : { title, description, location });
      updates.overridden_fields = overridden;
      if (follow.length > 0) {
        // A field left empty follows the calendar again: take its value from the calendar item as it is now.
        const source = await createRepos(supabase).calendarEvents.byId(current.calendar_event_id as string).catch(() => null);
        const fromCalendar = source ? calendarEventFields(source) : null;
        for (const field of follow) {
          if (fromCalendar) (updates as Record<string, unknown>)[field] = fromCalendar[field];
          else delete (updates as Record<string, unknown>)[field];
        }
      }
    }
    if (fromPrickle) delete updates.speakers;
    // An admin who has edited an event keeps it: the calendar sync no longer takes it away.
    updates.automatic = false;

    const event = await repos.events.edit(id, updates);

    return NextResponse.json({ event });
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
