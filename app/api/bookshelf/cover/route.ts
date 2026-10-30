import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createRepos } from "@/lib/data/repos";
import { BOOK_COVER_MAX_BYTES, bookCoverUrlFor } from "@/lib/bookCover";
import { storeImage, titleFromFileName } from "@/lib/media/library";

/** A member's own images, newest first, for choosing a cover again: `?q=` (title or tag), `?limit=`, `?offset=`. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const identity = await getEffectiveIdentity(user);
  if (!identity) return NextResponse.json({ error: "No member record" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const number = (name: string) => (params.has(name) && Number.isFinite(Number(params.get(name))) ? Number(params.get(name)) : undefined);
  try {
    const assets = await createRepos(await createClient()).media.search({ scope: { memberId: identity.memberId }, q: params.get("q") ?? undefined, limit: number("limit"), offset: number("offset") });
    return NextResponse.json({ assets });
  } catch (error) {
    console.error("Error listing a member's images:", error);
    return NextResponse.json({ error: "Failed to list images" }, { status: 500 });
  }
}

/**
 * A member's book cover (or a project's) goes into the media library as one of their own images, at any size.
 * The Bookshelf size and the Amazon ebook cover are made from it when asked for. Answers the URL the cover
 * is shown at, the asset (for the Amazon download) and its size.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return NextResponse.json({ error: "No member record" }, { status: 403 });

  const formData = await request.formData().catch(() => undefined);
  const file = formData?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > BOOK_COVER_MAX_BYTES) {
    return NextResponse.json({ error: `Cover must be under ${BOOK_COVER_MAX_BYTES / (1024 * 1024)} MB` }, { status: 400 });
  }

  try {
    const result = await storeImage(createRepos(supabase).media, createServiceRoleClient().storage, {
      bytes: Buffer.from(await file.arrayBuffer()),
      title: titleFromFileName(file.name),
      ownerMemberId: effectiveIdentity.memberId,
      createdBy: user.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    const { asset } = result;
    return NextResponse.json({
      url: bookCoverUrlFor(asset.id),
      assetId: asset.id,
      width: asset.width,
      height: asset.height,
      convertedFrom: result.convertedFrom,
      duplicate: result.duplicate,
    });
  } catch (error) {
    console.error("Book cover upload failed:", error);
    return NextResponse.json({ error: "Upload failed, try again" }, { status: 500 });
  }
}
