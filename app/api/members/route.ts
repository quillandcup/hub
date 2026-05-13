import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Get all members for dropdown/autocomplete
 * Supports ?email=xxx query parameter for lookup by email
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    let query = supabase
      .from("members")
      .select("id, name, email")
      .order("name");

    if (email) {
      query = query.ilike("email", email);
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
