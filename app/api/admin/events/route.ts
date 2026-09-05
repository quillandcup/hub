import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { data: events, error } = await supabase
    .from("events")
    .select("*, event_photos(id, hidden_at)")
    .order("starts_at", { ascending: false });

  if (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const withCounts = (events || []).map((e: any) => ({
    ...e,
    photo_count: (e.event_photos || []).filter((p: any) => !p.hidden_at).length,
    event_photos: undefined,
  }));

  return NextResponse.json({ events: withCounts });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { slug, title, event_type, location, starts_at, ends_at, focus, description, agenda, results, google_photos_album_url } = body;

    if (!slug || !title || !event_type || !starts_at || !ends_at) {
      return NextResponse.json(
        { error: "Missing required fields: slug, title, event_type, starts_at, ends_at" },
        { status: 400 }
      );
    }

    const { data: event, error } = await supabase
      .from("events")
      .insert({
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
        created_by: user.id === "service-role" || user.id === "cron" ? null : user.id,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Error creating event:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create event" }, { status: 500 });
  }
}
