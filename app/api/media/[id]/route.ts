import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { isId } from "@/lib/ids";
import { isFitMode, isPresetName } from "@/lib/media/presets";
import type { MediaAssetEdit } from "@/lib/data/media";

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
  if (body.focal !== undefined) {
    const f = body.focal;
    if (f === null) Object.assign(edit, { focal_x: null, focal_y: null });
    else if (typeof f?.x === "number" && typeof f?.y === "number" && f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1) Object.assign(edit, { focal_x: f.x, focal_y: f.y });
    else return NextResponse.json({ error: "focal must be null or { x, y } between 0 and 1" }, { status: 400 });
  }
  if (body.fits !== undefined) {
    const fits = body.fits;
    if (typeof fits !== "object" || fits === null || Object.entries(fits).some(([name, fit]) => !isPresetName(name) || !isFitMode(fit))) {
      return NextResponse.json({ error: "fits must map preset names to crop, extend or white" }, { status: 400 });
    }
    // Merge over the current choices: setting one preset leaves the others.
    const current = await media.byId(id);
    edit.fits = { ...((current?.fits as Record<string, string> | null) ?? {}), ...fits };
  }

  try {
    const asset = await media.edit(id, edit);
    if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ asset });
  } catch (error) {
    console.error("Error editing media:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

/** Staff remove an asset from the library (the files stay until nothing can need them; places that use it come with the PRs that add them). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isId(id, "media")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const removed = await createRepos(auth.supabase).media.remove(id);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("Error removing media:", error);
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
}
