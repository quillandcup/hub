import { createRepos } from "@/lib/data/repos";
import { createApiAuth } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

/** The widths a page may ask for with `?w=`: a grid thumbnail (2x of a ~240px cell) and the lightbox. Anything else is the original. */
export const PHOTO_WIDTHS = [480, 1600] as const;

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

  let photo: Awaited<ReturnType<ReturnType<typeof createRepos>["events"]["photoFile"]>>;
  try {
    photo = await createRepos(supabase).events.photoFile(eventId, photoId);
  } catch (error) {
    console.error("Error loading event photo:", error);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (photo.hidden_at) {
    const isPrivileged = user.id === "service-role" || user.id === "cron";
    const isAdmin = isPrivileged || (await createRepos(supabase).profiles.isAdmin(user.id));
    if (!isAdmin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from("event-photos")
    .download(photo.storage_path);

  if (downloadError || !file) {
    console.error("Error downloading event photo:", downloadError);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Imported originals are full camera size (several MB); pages ask for a sized copy.
  const requested = Number(request.nextUrl.searchParams.get("w"));
  const width = PHOTO_WIDTHS.find((w) => w === requested);
  // Private (this viewer's browser only), never a shared/public/CDN cache. A photo's bytes never change
  // (hiding it only changes who may ask), so the browser keeps its copy.
  const cacheControl = "private, max-age=86400";

  if (width) {
    try {
      const body = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": "image/webp", "Cache-Control": cacheControl } });
    } catch (error) {
      console.error("Error resizing event photo, serving the original:", error);
      return new NextResponse(await file.arrayBuffer(), {
        headers: { "Content-Type": photo.mime_type || "application/octet-stream", "Cache-Control": "private, max-age=300" },
      });
    }
  }

  return new NextResponse(await file.arrayBuffer(), {
    headers: { "Content-Type": photo.mime_type || "application/octet-stream", "Cache-Control": cacheControl },
  });
}
