import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { storeImage } from "@/lib/media/library";

/**
 * Staff use a photo from an event's gallery (the `event-photos` bucket, imported from Google Photos) as an image
 * in the media library, e.g. as the event's cover: `{ eventId, photoId }`. The photo is copied, so the gallery is
 * untouched, and the copy is remembered by its source (`event_photo`, `<event id>/<photo id>`): asking again
 * answers 200 with the same asset, a new one is 201.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => undefined);
  if (body === undefined || typeof body?.eventId !== "string" || typeof body?.photoId !== "string") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const repos = createRepos(auth.supabase);
    const [photo, event] = await Promise.all([repos.events.photoFile(body.eventId, body.photoId), repos.events.byId(body.eventId)]);
    if (!photo || !event) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const sourceKey = `${body.eventId}/${body.photoId}`;
    const existing = await repos.media.bySource("event_photo", sourceKey);
    if (existing) return NextResponse.json({ asset: existing, duplicate: true });

    const storage = createServiceRoleClient().storage;
    const { data: file, error: downloadError } = await storage.from("event-photos").download(photo.storage_path);
    if (downloadError || !file) {
      console.error("Couldn't read an event photo to copy it:", body.photoId, downloadError?.message);
      return NextResponse.json({ error: "Couldn't read that photo" }, { status: 502 });
    }

    const result = await storeImage(repos.media, storage, {
      bytes: Buffer.from(await file.arrayBuffer()),
      title: `${event.title} photo`,
      source: "event_photo",
      sourceKey,
      createdBy: auth.user.id === "service-role" || auth.user.id === "cron" ? null : auth.user.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ asset: result.asset, duplicate: result.duplicate, convertedFrom: result.convertedFrom }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    console.error("Error copying an event photo into the library:", error);
    return NextResponse.json({ error: "Couldn't use that photo, try again" }, { status: 500 });
  }
}
