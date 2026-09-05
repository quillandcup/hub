import { requireAdmin } from "@/lib/supabase/api-auth";
import {
  deletePickerSession,
  downloadMediaItemBytes,
  listPickedMediaItems,
  type PickedMediaItem,
} from "@/lib/google-photos-picker/client";
import { extensionForItem, planImportBatch } from "@/lib/google-photos-picker/import-batch";
import { clearImportSessionCookie, getImportSessionCookie } from "@/lib/google-photos-picker/import-session-cookie";
import { NextRequest, NextResponse } from "next/server";

// Chunked, not one long-held request: a single call that downloaded +
// uploaded an entire album would risk both a stuck browser tab and Vercel's
// function timeout on larger albums. The client calls this repeatedly,
// each call processing a small bounded batch, until `remaining` hits 0.
const BATCH_SIZE = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { id } = await params;
  const cookie = await getImportSessionCookie(id);
  if (!cookie) {
    return NextResponse.json({ error: "No active import session for this event -- start a new import" }, { status: 409 });
  }

  let allPicked: PickedMediaItem[];
  try {
    allPicked = await listPickedMediaItems(cookie.accessToken, cookie.sessionId);
  } catch (error: any) {
    console.error("Error listing picked media items:", error);
    return NextResponse.json({ error: error.message || "Failed to list picked photos" }, { status: 502 });
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("event_photos")
    .select("google_media_item_id")
    .eq("event_id", id);
  if (existingError) {
    console.error("Error checking already-imported photos:", existingError);
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  const existingIds = new Set((existingRows || []).map((r) => r.google_media_item_id));
  const { batch } = planImportBatch(allPicked, existingIds, BATCH_SIZE);

  const results = await Promise.all(
    batch.map(async (item) => {
      try {
        const { bytes, contentType } = await downloadMediaItemBytes(item.mediaFile.baseUrl, cookie.accessToken);
        const storagePath = `${id}/${item.id}.${extensionForItem(item)}`;
        const { error: uploadError } = await supabase.storage
          .from("event-photos")
          .upload(storagePath, bytes, { contentType: contentType || item.mediaFile.mimeType });
        if (uploadError) throw uploadError;

        const width = item.mediaFile.mediaFileMetadata?.width ? parseInt(item.mediaFile.mediaFileMetadata.width, 10) : null;
        const height = item.mediaFile.mediaFileMetadata?.height ? parseInt(item.mediaFile.mediaFileMetadata.height, 10) : null;

        const { error: insertError } = await supabase.from("event_photos").insert({
          event_id: id,
          storage_path: storagePath,
          google_media_item_id: item.id,
          width,
          height,
          mime_type: item.mediaFile.mimeType,
          taken_at: item.createTime || null,
        });
        if (insertError) throw insertError;
        return { ok: true as const };
      } catch (error: any) {
        console.error(`Error importing photo ${item.id}:`, error);
        return { ok: false as const, error: error.message || "Unknown error" };
      }
    })
  );

  const batchImported = results.filter((r) => r.ok).length;
  const imported = existingIds.size + batchImported;
  const total = allPicked.length;
  const remaining = total - imported;

  if (remaining <= 0) {
    try {
      await deletePickerSession(cookie.accessToken, cookie.sessionId);
    } catch (error) {
      console.error("Error cleaning up picker session (non-fatal):", error);
    }
    await clearImportSessionCookie();
  }

  return NextResponse.json({
    total,
    imported,
    skipped: existingIds.size,
    batchImported,
    remaining: Math.max(remaining, 0),
  });
}
