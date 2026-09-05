import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const [
    { data: event, error: eventError },
    { data: photos, error: photosError },
    { data: badgeType },
    { data: attendees, error: attendeesError },
  ] = await Promise.all([
    supabase.from("events").select("*").eq("id", id).single(),
    supabase
      .from("event_photos")
      .select("*")
      .eq("event_id", id)
      .order("taken_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase.from("badge_types").select("id, name, icon").eq("event_id", id).maybeSingle(),
    supabase
      .from("event_attendees")
      .select("id, member_id, members(name, email)")
      .eq("event_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 404 });
  if (photosError) {
    console.error("Error fetching event photos:", photosError);
    return NextResponse.json({ error: photosError.message }, { status: 500 });
  }
  if (attendeesError) {
    console.error("Error fetching event attendees:", attendeesError);
    return NextResponse.json({ error: attendeesError.message }, { status: 500 });
  }

  const attendeeRows = (attendees ?? []).map((a: any) => ({
    id: a.id,
    memberId: a.member_id,
    memberName: a.members?.name ?? "Unknown",
    memberEmail: a.members?.email ?? "",
  }));

  return NextResponse.json({ event, photos: photos || [], badgeType: badgeType ?? null, attendees: attendeeRows });
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
    const body = await request.json();
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
    } = body;

    const updates: Record<string, unknown> = {};
    if (slug !== undefined) updates.slug = slug;
    if (title !== undefined) updates.title = title;
    if (event_type !== undefined) updates.event_type = event_type;
    if (location !== undefined) updates.location = location;
    if (starts_at !== undefined) updates.starts_at = starts_at;
    if (ends_at !== undefined) updates.ends_at = ends_at;
    if (focus !== undefined) updates.focus = focus;
    if (description !== undefined) updates.description = description;
    if (agenda !== undefined) updates.agenda = agenda;
    if (results !== undefined) updates.results = results;
    if (google_photos_album_url !== undefined) updates.google_photos_album_url = google_photos_album_url;

    const { data: event, error } = await supabase
      .from("events")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("Error updating event:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
  const { data: photos } = await supabase.from("event_photos").select("storage_path").eq("event_id", id);
  if (photos && photos.length > 0) {
    await supabase.storage.from("event-photos").remove(photos.map((p) => p.storage_path));
  }

  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) {
    console.error("Error deleting event:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
