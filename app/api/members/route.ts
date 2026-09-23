import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

const MAX_LIMIT = 50;

/**
 * Get members for dropdown/autocomplete (admin only).
 *
 * Query params:
 * - email:  exact (case-insensitive) lookup by email
 * - search: case-insensitive substring match on name or email
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

    let query = supabase
      .from("members")
      .select("id, name, email")
      .order("name");

    if (email) {
      query = query.ilike("email", email);
    } else if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (limit !== null) {
      query = query.limit(limit);
    }

    const { data: members, error } = await query;

    if (error) throw error;

    return NextResponse.json({ members: members || [] });
  } catch (error: any) {
    console.error("Error fetching members:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch members" },
      { status: 500 }
    );
  }
}
