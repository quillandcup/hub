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

  const { data: photo, error } = await supabase
    .from("event_photos")
    .update({ hidden_at: body.hidden ? new Date().toISOString() : null })
    .eq("id", photoId)
    .eq("event_id", id)
    .select("*")
    .single();

  if (error) {
    console.error("Error updating photo visibility:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ photo });
}
