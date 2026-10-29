import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createRepos } from "@/lib/data/repos";
import type { MediaAsset } from "@/lib/data/media";
import { isId } from "@/lib/ids";
import { renditionOf } from "@/lib/media/library";
import { isPresetName, PRESETS, presetExtension } from "@/lib/media/presets";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * An image at a preset's size. The bucket is private, so every image comes through here: a signed-in
 * caller gets what row-level security lets them read (the shared library, their own, everything for
 * staff), and anyone, signed in or not, gets an asset marked public. Anything else is a plain 404.
 * `?download=1` offers the file for download under the preset's file name (the Amazon cover).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; preset: string }> }) {
  const { id, preset } = await params;
  if (!isId(id, "img") || !isPresetName(preset)) return new NextResponse("Not found", { status: 404 });

  const service = createServiceRoleClient();
  const user = await getCurrentUser();
  let asset: MediaAsset | null = null;
  if (user) asset = await createRepos(await createClient()).media.byId(id).catch(() => null);
  if (!asset || asset.deleted_at) {
    const publicAsset = await createRepos(service).media.byId(id).catch(() => null);
    asset = publicAsset && publicAsset.is_public && !publicAsset.deleted_at ? publicAsset : null;
  }
  if (!asset) return new NextResponse("Not found", { status: 404 });

  const result = await renditionOf(service.storage, asset, preset);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const def = PRESETS[preset];
  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Cache-Control": asset.is_public ? "public, max-age=3600, stale-while-revalidate=86400" : "private, max-age=3600",
  };
  const downloadName = "downloadName" in def ? def.downloadName : undefined;
  if (request.nextUrl.searchParams.get("download") === "1" && downloadName) {
    headers["Content-Disposition"] = `attachment; filename="${downloadName}.${presetExtension(def)}"`;
  }
  return new NextResponse(result.body as BodyInit, { headers });
}
