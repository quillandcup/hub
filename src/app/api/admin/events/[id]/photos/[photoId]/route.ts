import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Hide/unhide only -- deliberately no DELETE here. Hiding is soft (sets
// hidden_at) so a hidden photo still satisfies the google_media_item_id
// dedup check on re-sync; see the migration comment on event_photos.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id, photoId } = await params;

  const body = await request.json().catch(() => ({}));
  if (typeof body.hidden !== "boolean") {
    return NextResponse.json({ error: "Missing required field: hidden (boolean)" }, { status: 400 });
  }

  try {
    const photo = await createRepos(supabase).events.setPhotoHidden(id, photoId, body.hidden);
    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    return NextResponse.json({ photo });
  } catch (error: any) {
    console.error("Error updating photo visibility:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
