import { NextRequest, NextResponse } from "next/server";
import { getCoursesCaller } from "@/lib/courses/caller";
import { imageTable, type CourseImageKind } from "@/lib/courses/images";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import { MEDIA_BUCKET } from "@/lib/media/library";
import { isId } from "@/lib/ids";

const PREFIXES = { course: "crs", hero: "crs", module: "mod", lesson: "les" } as const;

/**
 * A course image (cover, hero banner, module poster or lesson thumbnail) copied from Kajabi into the media library. The
 * bucket is private, so images come through here: the caller must be able to use the courses feature, and a hidden
 * (draft) module or lesson's image is for staff acting as themselves only. Anything else is a plain 404.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!(kind in PREFIXES) || !isId(id, PREFIXES[kind as CourseImageKind])) return new NextResponse("Not found", { status: 404 });

  const caller = await getCoursesCaller();
  if (!caller) return new NextResponse("Not found", { status: 404 });

  const t = imageTable(kind as CourseImageKind);
  const supabase = createServiceRoleClient();
  const columns = kind === "course" || kind === "hero" ? t.assetColumn : `${t.assetColumn}, state`;
  const { data: row } = await supabase.from(t.table).select(columns).eq("id", id).maybeSingle();
  const assetId = (row as any)?.[t.assetColumn] as string | null | undefined;
  if (!assetId) return new NextResponse("Not found", { status: 404 });
  if (kind !== "course" && kind !== "hero" && (row as any).state === "hidden" && !caller.scope.isAdminActing) return new NextResponse("Not found", { status: 404 });

  const asset = await createRepos(supabase).media.byId(assetId).catch(() => null);
  if (!asset || asset.deleted_at) return new NextResponse("Not found", { status: 404 });
  const { data: blob, error } = await supabase.storage.from(MEDIA_BUCKET).download(asset.storage_path);
  if (error || !blob) {
    console.error("Couldn't read a course image:", error?.message);
    return new NextResponse("Couldn't load the image", { status: 502 });
  }
  return new NextResponse(await blob.arrayBuffer(), {
    headers: { "Content-Type": asset.mime_type, "Cache-Control": "private, max-age=3600" },
  });
}
