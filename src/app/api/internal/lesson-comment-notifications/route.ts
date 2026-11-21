import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";
import { sendLessonCommentDigests, sendModerationDigest } from "@/lib/courses/comment-notifications";
import { withCronHeartbeat } from "@/lib/cron-heartbeats";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const maxDuration = 300;

/**
 * The daily lesson comment notifications (src/lib/courses/comment-notifications.ts, docs/product/COURSES.md, "Lesson comments"): members get
 * one note about new comments on the lessons they follow, and staff get one note while reported or held comments wait.
 * (Replies are sent as they happen, from the comment actions.)
 *
 * Scheduled daily (14:30 UTC) via Vercel Cron (GET); an admin can run it by opening the URL. Idempotent: each member is claimed
 * once per Eastern day in `notification_log`. The `lesson_comment_notifications` feature flag says who gets it for real
 * (globally, a segment, or an admin's own preview); for everyone else it only logs and records nothing. Each half is tried on
 * its own, so a failure in one does not stop the other.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The claims and the members' contact details are service-role only, whoever asked.
  const repos = createRepos(createServiceRoleClient());
  const now = new Date(clock.now());
  const [digests, staff] = await Promise.allSettled([sendLessonCommentDigests(repos, now), sendModerationDigest(repos, now)]);
  const summary = (outcome: PromiseSettledResult<{ sent: unknown[]; dryRun: unknown[] }>) =>
    outcome.status === "fulfilled" ? { sent: outcome.value.sent.length, dryRun: outcome.value.dryRun.length } : { error: "failed" };
  for (const outcome of [digests, staff]) {
    if (outcome.status === "rejected") console.error("[lesson-comment-notifications] failed:", outcome.reason instanceof Error ? outcome.reason.message : outcome.reason);
  }
  const body = { members: summary(digests), staff: summary(staff) };
  console.log("[lesson-comment-notifications]", body);
  // A failed half is not a healthy run: no heartbeat, so the monitor says so.
  if (digests.status === "rejected" || staff.status === "rejected") return NextResponse.json(body, { status: 500 });
  return withCronHeartbeat("lesson-comment-notifications", NextResponse.json(body));
}
