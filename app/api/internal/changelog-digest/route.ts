import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";
import { withCronHeartbeat } from "@/lib/cron-heartbeats";
import { createRepos } from "@/lib/data/repos";
import { isFeatureOnForEveryone, membersWithFeatureForOutreach } from "@/lib/features.server";
import { postChangelogToChannel, sendChangelogDigest } from "@/lib/changelog/digest";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const maxDuration = 300;

/**
 * The weekly "What's new" digest (lib/changelog/digest.ts, docs/CHANGELOG_PROCESS.md): members get the changelog entries
 * they haven't been sent on the channels they chose, and the new entries are posted to the announcements channel.
 *
 * Scheduled weekly (Tuesday 14:00 UTC) via Vercel Cron (GET); an admin can run it by opening the URL. Idempotent: each entry
 * is claimed per recipient in `notification_log`, so a second run sends only what the first did not. The `changelog_digest`
 * feature flag says who gets it for real (globally, a segment, or an admin's own preview); for everyone else it only logs.
 * The channel post goes out only when the flag is on for everyone.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The claims and the members' contact details are service-role only, whoever asked.
  const repos = createRepos(createServiceRoleClient());
  const now = new Date(clock.now());
  const members = await sendChangelogDigest(repos, now, {
    liveFor: (memberIds) => membersWithFeatureForOutreach(repos, "changelog_digest", memberIds),
  });
  const channel = await postChangelogToChannel(repos, now, { live: await isFeatureOnForEveryone(repos, "changelog_digest") });
  console.log("[changelog-digest]", { members, channel });
  return withCronHeartbeat("changelog-digest", NextResponse.json({ members, channel }));
}
