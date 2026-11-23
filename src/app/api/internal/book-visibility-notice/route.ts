import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";
import { createRepos } from "@/lib/data/repos";
import { membersWithFeatureForOutreach } from "@/lib/features.server";
import { sendBookVisibilityNotices } from "@/lib/book-visibility-notice";
import { requireApiPermission } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const maxDuration = 300;

/**
 * The one-time heads-up that a member's published books are on the public Hedgie Bookshelf (src/lib/book-visibility-notice.ts). Not
 * scheduled: an admin runs it by opening the URL, after reading what a dry run logged. Idempotent: each member is claimed once in
 * `notification_log`, so a second run tells nobody twice. The `book_visibility_notice` feature flag says who is told for real
 * (globally, a segment, or an admin's own preview); for everyone else it only logs who it would have told and what it would have
 * said (see the logs of this route), and writes nothing.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "system.internal.run");
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The claims and the members' contact details are service-role only, whoever asked.
  const repos = createRepos(createServiceRoleClient());
  const result = await sendBookVisibilityNotices(repos, new Date(clock.now()), {
    liveFor: (memberIds) => membersWithFeatureForOutreach(repos, "book_visibility_notice", memberIds),
  });
  console.log("[book-visibility-notice]", result);
  return NextResponse.json(result);
}
