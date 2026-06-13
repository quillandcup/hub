import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * Get all members for dropdown/autocomplete
 * Supports ?email=xxx query parameter for lookup by email
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    const search = searchParams.get("search");

    let query = supabase
      .from("members")
      .select("id, name, email")
      .order("name");

    if (email) {
      query = query.ilike("email", email);
    } else if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
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
