import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Logs one occurrence of a badge for a member (e.g. one quarter hosted, one retreat attended).
// For a has_levels badge type this doesn't set a level directly -- the member's displayed level
// is derived from how many occurrence rows they have (see lib/badges.ts deriveLevel()), so
// awarding the same badge type again is how an admin "levels someone up".
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const { memberId, badgeTypeId, occurredAt, note } = parsed;

    if (!memberId || !badgeTypeId) {
      return NextResponse.json({ error: "memberId and badgeTypeId are required" }, { status: 400 });
    }

    const badges = createRepos(supabase).badges;
    const badgeType = await badges.typeById(badgeTypeId);
    if (!badgeType) {
      return NextResponse.json({ error: "Badge type not found" }, { status: 404 });
    }
    if (badgeType.is_automatic) {
      return NextResponse.json(
        { error: "This badge is computed automatically and can't be manually awarded" },
        { status: 400 }
      );
    }
    if (badgeType.event_id) {
      return NextResponse.json(
        { error: "This badge is granted by event attendance -- manage attendees on the event page instead" },
        { status: 400 }
      );
    }

    const memberBadge = await badges.award({
      memberId,
      badgeTypeId,
      occurredAt: occurredAt || undefined,
      note: note?.trim() || null,
      awardedBy: user.id !== "service-role" && user.id !== "cron" ? user.id : null,
    });

    return NextResponse.json({ memberBadge }, { status: 201 });
  } catch (error: any) {
    console.error("Error in award badge route:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
