import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import { sweepMedia } from "@/lib/media/sweep";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";

export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Nightly housekeeping for the media library's bucket: removes uploads that were started and never confirmed,
 * and the files of images deleted over 30 days ago (the rows stay). See lib/media/sweep.ts.
 *
 * Scheduled to run daily at 3:30am via Vercel Cron. Vercel Cron always invokes via GET.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const service = createServiceRoleClient();
    const result = await sweepMedia(createRepos(service).media, service.storage);
    console.log("[Reconciliation] Media sweep complete:", result);
    await pingCronHeartbeat("reconcile-media");
    return NextResponse.json({ success: true, reconciliation: "media", ...result });
  } catch (error: any) {
    console.error("[Reconciliation] Error sweeping media:", error);
    return NextResponse.json({ error: error.message || "Failed to sweep media" }, { status: 500 });
  }
}
