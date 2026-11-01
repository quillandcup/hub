import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { isId } from "@/lib/ids";
import { parseLookEdit } from "@/lib/media/edit";
import type { MediaAssetEdit } from "@/lib/data/media";

/** Staff read one asset (a deleted one too) and where it is used. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isId(id, "media")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const media = createRepos(auth.supabase).media;
    const asset = await media.byId(id);
    if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ asset, usages: await media.usages(id) });
  } catch (error) {
    console.error("Error reading media:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

/** Staff change an asset's title, alt text, tags, focal point, public flag or how a preset fits it. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => undefined);
  if (body === undefined || typeof body !== "object" || body === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { id } = await params;
  if (!isId(id, "media")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const media = createRepos(auth.supabase).media;
  const edit: MediaAssetEdit = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return NextResponse.json({ error: "title can't be empty" }, { status: 400 });
    edit.title = body.title.trim().slice(0, 120);
  }
  if (body.alt_text !== undefined) edit.alt_text = typeof body.alt_text === "string" && body.alt_text.trim() ? body.alt_text.trim() : null;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((t: unknown) => typeof t !== "string")) return NextResponse.json({ error: "tags must be a list of strings" }, { status: 400 });
    edit.tags = body.tags;
  }
  if (body.is_public !== undefined) {
    if (typeof body.is_public !== "boolean") return NextResponse.json({ error: "is_public must be true or false" }, { status: 400 });
    edit.is_public = body.is_public;
  }
  const look = parseLookEdit(body, body.fits !== undefined ? await media.byId(id) : null);
  if ("error" in look) return NextResponse.json({ error: look.error }, { status: 400 });
  Object.assign(edit, look.edit);

  try {
    const asset = await media.edit(id, edit);
    if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ asset });
  } catch (error) {
    console.error("Error editing media:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

/** Staff remove an asset from the library, unless something still shows it (409, with the list). The files stay until they are swept (docs/TODO.md). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isId(id, "media")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const media = createRepos(auth.supabase).media;
    const usages = await media.usages(id);
    if (usages.length > 0) {
      return NextResponse.json({ error: "This image is still in use. Pick another for those first.", usages }, { status: 409 });
    }
    const removed = await media.remove(id);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("Error removing media:", error);
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
}
