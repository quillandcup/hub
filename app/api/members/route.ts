import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { getHostEligibility } from "@/lib/host-eligibility";
import { NextRequest, NextResponse } from "next/server";

const MAX_LIMIT = 50;

/**
 * Get members for dropdown/autocomplete (admin only).
 *
 * Query params:
 * - email:  exact (case-insensitive) lookup by email
 * - search: case-insensitive substring match on name, display name or email
 * - limit:  cap the number of rows returned (1-50). Used by search-as-you-type
 *           pickers (e.g. the sudo "View As Member" modal) so they never pull
 *           the whole table.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    // Strip characters that are syntax in a PostgREST or() filter (commas,
    // parens, quotes, backslashes) or ilike wildcards, so user input can't
    // break or widen the filter.
    const search = searchParams.get("search")?.replace(/[,()"\\%*]/g, " ").trim();
    const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
      : null;

    // An email lookup ignores the search text, as it always has.
    const found = await createRepos(supabase).members.search({
      emailEquals: email ?? undefined,
      words: !email && search ? [search] : undefined,
      limit: limit ?? undefined,
    });
    const members = found.map(({ id, name, displayName, email: address }) => ({ id, name, displayName, email: address }));

    // Exact-email lookups back admin forms that assign a specific member (e.g.
    // "add host" on /admin/hosts), which warn up front when that member hasn't
    // been a member for a full month yet -- so include host eligibility there.
    if (email) {
      const now = new Date();
      return NextResponse.json({
        members: found.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          host_eligibility: getHostEligibility({ firstJoinedAt: m.firstJoinedAt, mostRecentJoinedAt: m.mostRecentJoinedAt }, now),
        })),
      });
    }

    return NextResponse.json({ members });
  } catch (error: any) {
    console.error("Error fetching members:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch members" },
      { status: 500 }
    );
  }
}
