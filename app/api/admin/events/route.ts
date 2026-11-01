import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { eventImageError } from "@/lib/media/event-image";
import { NextRequest, NextResponse } from "next/server";
import { parseEventAudience, parseGuestSpeakers } from "@/lib/event-audience";
import { eventWindow } from "@/lib/event-window";
import { isId } from "@/lib/ids";
import { EVENT_TYPES, isEventType } from "@/lib/events-filter";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    return NextResponse.json({ events: await createRepos(supabase).events.listWithPhotoCounts() });
  } catch (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { slug, title, event_type, location, starts_at, ends_at, start_clock, end_clock, host_name, host_id, focus, description, agenda, results, google_photos_album_url, image_id } = body;

    if (!slug || !title || !event_type || !starts_at || !ends_at) {
      return NextResponse.json(
        { error: "Missing required fields: slug, title, event_type, starts_at, ends_at" },
        { status: 400 }
      );
    }

    if (!isEventType(event_type)) {
      return NextResponse.json({ error: `event_type must be one of: ${EVENT_TYPES.join(", ")}` }, { status: 400 });
    }
    const audience = parseEventAudience(body);
    if (!audience.ok) return NextResponse.json({ error: audience.error }, { status: 400 });
    const speakers = parseGuestSpeakers(body);
    if (!speakers.ok) return NextResponse.json({ error: speakers.error }, { status: 400 });
    const window = eventWindow({ startDate: starts_at, endDate: ends_at, startClock: start_clock, endClock: end_clock });
    if (!window.ok) return NextResponse.json({ error: window.error }, { status: 400 });
    const repos = createRepos(supabase);
    const imageError = await eventImageError(repos.media, image_id);
    if (imageError) return NextResponse.json({ error: imageError }, { status: 400 });

    if (host_id !== undefined && host_id !== null && !isId(host_id, "mbr")) return NextResponse.json({ error: "That host isn't a member" }, { status: 400 });
    const hostId: string | null = typeof host_id === "string" ? host_id : null;

    // An event made in the Hub has no calendar item: its schedule is a Hub session, projected into the prickle it stands on.
    const session = await repos.hubSessions.create({
      title,
      description: description || null,
      location: location || null,
      // A member hosts it (their name is shown), or someone who isn't one is named in text.
      hostId: hostId ?? null,
      hostName: hostId ? null : typeof host_name === "string" && host_name.trim() ? host_name.trim() : null,
      guestSpeaker: speakers.value ?? null,
      startTime: window.startTime,
      endTime: window.endTime,
    });
    if (!session.prickleId) throw new Error("The event's session has no prickle");

    let event;
    try {
      event = await repos.events.create({
        ...audience.fields,
        slug,
        prickle_id: session.prickleId,
        event_type,
        focus: focus || null,
        agenda: agenda || null,
        results: results || null,
        google_photos_album_url: google_photos_album_url || null,
        image_id: image_id ?? null,
        created_by: user.id === "service-role" || user.id === "cron" ? null : user.id,
      });
    } catch (error) {
      // Don't leave a schedule with no event behind (a taken slug, say).
      await repos.hubSessions.remove(session.id).catch(() => {});
      throw error;
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create event" }, { status: 500 });
  }
}
