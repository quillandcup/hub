import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Get all members for dropdown/autocomplete
 */
export async function GET() {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: members, error } = await supabase
      .from("members")
      .select("id, name, email")
      .order("name");

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
