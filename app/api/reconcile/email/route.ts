import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { createRepos } from "@/lib/data/repos";
import { pullEmailEvents } from "@/lib/email-events-pull";
import { requireAdmin } from "@/lib/supabase/api-auth";

export const maxDuration = 300;

const DEFAULT_DAYS = 3;
const MAX_DAYS = 90;

/**
 * Nightly reconciliation of Resend email events (docs/EMAIL_TIMELINE.md). The webhook (/api/webhooks/resend) is
 * the fast path; this lists the emails sent in the last few days and records what it missed, then rebuilds
 * their member timeline rows. `?days=N` (up to 90) looks further back, for a backfill after the webhook was off.
 *
 * Needs a RESEND_API_KEY with full access: a sending-only key cannot list emails, and the run fails with
 * Resend's answer rather than importing nothing.
 *
 * Scheduled daily at 03:45 UTC via Vercel Cron (GET). It pings its Checkly heartbeat when one is configured;
 * none is, for now (lib/cron-heartbeats.ts, `unmonitored`).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 500 });

  const requested = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_DAYS) : DEFAULT_DAYS;
  const since = new Date(clock.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = await pullEmailEvents(createRepos(auth.supabase), apiKey, since);
    console.log("[Reconciliation] Resend email events:", { days, ...result });
    await pingCronHeartbeat("reconcile-email");
    return NextResponse.json({ success: true, reconciliation: "email", days, ...result });
  } catch (error) {
    console.error("[Reconciliation] Error importing Resend email events:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to import email events" }, { status: 500 });
  }
}
