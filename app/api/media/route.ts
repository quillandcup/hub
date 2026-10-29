import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { MEDIA_BUCKET, storeImage, titleFromFileName } from "@/lib/media/library";
import { normalizeTags } from "@/lib/data/media";

/** Staff browse the shared library: `?q=` (title or tag), `?tag=`, `?limit=`, `?offset=`. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const number = (name: string) => (params.has(name) && Number.isFinite(Number(params.get(name))) ? Number(params.get(name)) : undefined);
  try {
    const assets = await createRepos(auth.supabase).media.search({
      scope: "shared",
      q: params.get("q") ?? undefined,
      tag: params.get("tag") ?? undefined,
      limit: number("limit"),
      offset: number("offset"),
    });
    return NextResponse.json({ assets });
  } catch (error) {
    console.error("Error listing media:", error);
    return NextResponse.json({ error: "Failed to list media" }, { status: 500 });
  }
}

/**
 * Staff add an image to the shared library, either as multipart form data (`file`, optional `title`,
 * `tags` comma separated) or, for a file too big for a request body, as JSON `{ uploadPath, title?, tags? }`
 * after uploading it to the signed URL from `POST /api/media/uploads`. The same bytes twice answer 200 with
 * the existing asset; a new one is 201.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const storage = createServiceRoleClient().storage;
  let bytes: Buffer;
  let title: string | null;
  let tags: string[];
  let pendingPath: string | null = null;

  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await request.json().catch(() => undefined);
    if (body === undefined || typeof body?.uploadPath !== "string") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    if (!/^uploads\/[A-Za-z0-9-]+$/.test(body.uploadPath)) return NextResponse.json({ error: "Unknown upload" }, { status: 400 });
    const { data, error } = await storage.from(MEDIA_BUCKET).download(body.uploadPath);
    if (error || !data) return NextResponse.json({ error: "That upload isn't there. Upload the file first" }, { status: 400 });
    pendingPath = body.uploadPath;
    bytes = Buffer.from(await data.arrayBuffer());
    title = typeof body.title === "string" ? body.title : null;
    tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : [];
  } else {
    const form = await request.formData().catch(() => undefined);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    bytes = Buffer.from(await file.arrayBuffer());
    title = (form?.get("title") as string | null) || titleFromFileName(file.name);
    tags = String(form?.get("tags") ?? "").split(",");
  }

  try {
    const result = await storeImage(createRepos(auth.supabase).media, storage, {
      bytes,
      title,
      tags: normalizeTags(tags),
      createdBy: auth.user.id === "service-role" || auth.user.id === "cron" ? null : auth.user.id,
    });
    if (pendingPath) await storage.from(MEDIA_BUCKET).remove([pendingPath]);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ asset: result.asset, duplicate: result.duplicate, convertedFrom: result.convertedFrom }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    console.error("Error storing media:", error);
    return NextResponse.json({ error: "Upload failed, try again" }, { status: 500 });
  }
}
