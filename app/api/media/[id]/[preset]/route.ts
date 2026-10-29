import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createRepos } from "@/lib/data/repos";
import type { MediaAsset } from "@/lib/data/media";
import { isId } from "@/lib/ids";
import { parseCustomSize } from "@/lib/media/custom";
import { MEDIA_BUCKET, renditionOf } from "@/lib/media/library";
import { isPresetName, PRESETS } from "@/lib/media/presets";
import { FORMAT_INFO, renderImage, settingsFor } from "@/lib/media/render";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** The file name for a download: the title as a slug, then what it is ("hedgies-on-first-1600x2560.jpg"). */
function downloadName(title: string, suffix: string): string {
  const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "image"}-${suffix}`;
}

/**
 * An image at a size. The bucket is private, so every image comes through here: a signed-in caller gets
 * what row-level security lets them read (the shared library, their own, everything for staff), and anyone,
 * signed in or not, gets an asset marked public. Anything else is a plain 404.
 *
 * `[preset]` is a preset's name (`event_card`, `book_cover_kdp_ebook`, ...), or:
 * - `custom`: any size, `?width=&height=` with optional `&format=` and `&fit=` (signed-in callers only, never cached);
 * - `original`: the file as uploaded (staff only).
 * Add `?download=1` to any of them to have the browser save the file.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; preset: string }> }) {
  const { id, preset } = await params;
  const wantsCustom = preset === "custom";
  const wantsOriginal = preset === "original";
  if (!isId(id, "media") || !(isPresetName(preset) || wantsCustom || wantsOriginal)) return new NextResponse("Not found", { status: 404 });

  const service = createServiceRoleClient();
  const user = await getCurrentUser();
  if ((wantsCustom || wantsOriginal) && !user) return new NextResponse("Not found", { status: 404 });

  let asset: MediaAsset | null = null;
  if (user) asset = await createRepos(await createClient()).media.byId(id).catch(() => null);
  if (!asset || asset.deleted_at) {
    const publicAsset = await createRepos(service).media.byId(id).catch(() => null);
    asset = publicAsset && publicAsset.is_public && !publicAsset.deleted_at ? publicAsset : null;
  }
  if (!asset) return new NextResponse("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const headers: Record<string, string> = { "Cache-Control": asset.is_public ? "public, max-age=3600, stale-while-revalidate=86400" : "private, max-age=3600" };
  const saveAs = (name: string) => {
    if (download) headers["Content-Disposition"] = `attachment; filename="${name}"`;
  };

  if (wantsOriginal) {
    if (!user || !(await createRepos(await createClient()).profiles.isAdmin(user.id))) return new NextResponse("Not found", { status: 404 });
    const file = await service.storage.from(MEDIA_BUCKET).download(asset.storage_path);
    if (file.error || !file.data) return NextResponse.json({ error: "Couldn't load the image" }, { status: 502 });
    headers["Content-Type"] = asset.mime_type;
    saveAs(downloadName(asset.title, `original.${asset.storage_path.split(".").pop()}`));
    return new NextResponse(await file.data.arrayBuffer(), { headers });
  }

  if (wantsCustom) {
    const size = parseCustomSize(request.nextUrl.searchParams);
    if (!size.ok) return NextResponse.json({ error: size.error }, { status: 400 });
    const original = await service.storage.from(MEDIA_BUCKET).download(asset.storage_path);
    if (original.error || !original.data) return NextResponse.json({ error: "Couldn't load the image" }, { status: 502 });
    const settings = { ...settingsFor(asset, "thumb"), fit: size.fit };
    const { body, contentType } = await renderImage(Buffer.from(await original.data.arrayBuffer()), size.spec, settings);
    headers["Content-Type"] = contentType;
    saveAs(downloadName(asset.title, `${size.spec.width}x${size.spec.height}.${FORMAT_INFO[size.spec.format].extension}`));
    return new NextResponse(new Uint8Array(body), { headers });
  }

  const result = await renditionOf(service.storage, asset, preset as keyof typeof PRESETS);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  headers["Content-Type"] = result.contentType;
  const def = PRESETS[preset as keyof typeof PRESETS];
  const presetName = "downloadName" in def ? def.downloadName : undefined;
  saveAs(presetName ? `${presetName}.${FORMAT_INFO[def.format].extension}` : downloadName(asset.title, `${preset}.${FORMAT_INFO[def.format].extension}`));
  return new NextResponse(result.body as BodyInit, { headers });
}
