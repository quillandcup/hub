import { createApiAuth } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Authenticated image proxy, not a public/signed Storage URL -- event photos
// aren't meant to be shareable off-site (unlike book-covers). Any logged-in
// member or admin can view a non-hidden photo; only admins can see a hidden
// one (e.g. reviewing the admin "Hidden photos" section). Since this relies
// on the viewer's own session cookie, a copy-pasted link is useless to
// anyone without their own valid login.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string; photoId: string }> }
) {
  const auth = await createApiAuth(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { supabase, user } = auth;

  const { eventId, photoId } = await params;

  const { data: photo, error } = await supabase
    .from("event_photos")
    .select("storage_path, mime_type, hidden_at")
    .eq("id", photoId)
    .eq("event_id", eventId)
    .single();

  if (error || !photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (photo.hidden_at) {
    const isPrivileged = user.id === "service-role" || user.id === "cron";
    const isAdmin =
      isPrivileged ||
      (
        await supabase.from("user_profiles").select("role").eq("id", user.id).single()
      ).data?.role === "admin";
    if (!isAdmin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from("event-photos")
    .download(photo.storage_path);

  if (downloadError || !file) {
    console.error("Error downloading event photo:", downloadError);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(await file.arrayBuffer(), {
    headers: {
      "Content-Type": photo.mime_type || "application/octet-stream",
      // Private (this viewer's browser only), never a shared/public/CDN cache.
      "Cache-Control": "private, max-age=300",
    },
  });
}
