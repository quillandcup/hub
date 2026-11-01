import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { assetUpdateFromEvent, createMuxClient, unwrapWebhook, uploadAssetFromEvent } from "@/lib/mux";

export const maxDuration = 60;

/**
 * Mux webhook: tells us when a course video's asset is ready (or failed), so `videos` can move
 * from "preparing" to "ready" and carry its playback id and duration.
 *
 * Idempotent: Mux redelivers, and the update sets the same values every time. Preview deployments
 * have changing URLs, so they poll Mux for status instead of using this route.
 * Every request is refused while MUX_WEBHOOK_SECRET is unset: verification needs the secret, so
 * there is no unsigned path (see lib/webhook-auth.ts for the same rule on the other webhooks).
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  let event;
  try {
    event = await unwrapWebhook(createMuxClient(), body, request.headers);
  } catch (error) {
    console.error("Invalid Mux webhook:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // A browser upload is complete: Mux made the asset, and the video row of that upload (made when the upload
  // was started) learns which one. Every later event of the asset then finds the row by it.
  const uploaded = uploadAssetFromEvent(event);
  if (uploaded) {
    try {
      const courses = createRepos(supabase).courses;
      const [video] = await courses.videosBySourceKeys("upload", [uploaded.uploadId]);
      // An upload nobody here started (another environment's) is not ours to record.
      if (!video) return NextResponse.json({ received: true, processed: false });
      await courses.updateVideo(video.id, { mux_asset_id: uploaded.assetId });
    } catch (error) {
      console.error("Failed to record Mux upload:", error);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
    return NextResponse.json({ received: true, processed: true });
  }

  const update = assetUpdateFromEvent(event);
  if (!update) return NextResponse.json({ received: true, processed: false });

  let updated: number;
  try {
    updated = await createRepos(supabase).courses.updateVideosByAsset(update.muxAssetId, {
      status: update.status,
      ...(update.playbackId ? { mux_playback_id: update.playbackId } : {}),
      ...(update.durationSeconds !== undefined ? { duration_seconds: update.durationSeconds } : {}),
    });
    // A lesson made in the Hub shows its video's length; an imported one has Kajabi's.
    if (updated > 0 && update.durationSeconds !== undefined) await createRepos(supabase).courses.syncLessonDurations(update.muxAssetId);
  } catch (error) {
    console.error("Failed to record Mux asset update:", error);
    // A 5xx makes Mux retry.
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (updated === 0) {
    // The asset id is saved right after the asset is created, so an early event can arrive first;
    // answer 500 so Mux redelivers rather than losing the "ready".
    console.warn("Mux event for an asset with no videos row yet: %s", update.muxAssetId);
    return NextResponse.json({ error: "Unknown asset" }, { status: 500 });
  }

  return NextResponse.json({ received: true, processed: true });
}
