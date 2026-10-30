import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { eventImageError } from "@/lib/media/event-image";
import { NextRequest, NextResponse } from "next/server";
import { parseEventAudience } from "@/lib/event-audience";
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
    const { slug, title, event_type, location, starts_at, ends_at, focus, description, agenda, results, google_photos_album_url, image_id } = body;

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
    const repos = createRepos(supabase);
    const imageError = await eventImageError(repos.media, image_id);
    if (imageError) return NextResponse.json({ error: imageError }, { status: 400 });

    const event = await repos.events.create({
        ...audience.fields,
        slug,
        title,
        event_type,
        location: location || null,
        starts_at,
        ends_at,
        focus: focus || null,
        description: description || null,
        agenda: agenda || null,
        results: results || null,
        google_photos_album_url: google_photos_album_url || null,
        image_id: image_id ?? null,
        created_by: user.id === "service-role" || user.id === "cron" ? null : user.id,
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create event" }, { status: 500 });
  }
}
