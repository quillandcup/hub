import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/prickle-types/create
 * Create a new prickle type
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, description } = await request.json();

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    // Generate normalized name from name
    const normalizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .trim();

    // Check if normalized name already exists
    const { data: existing } = await supabase
      .from("prickle_types")
      .select("id")
      .eq("normalized_name", normalizedName)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "A prickle type with this name already exists" },
        { status: 409 }
      );
    }

    // Create the prickle type
    const { data: prickleType, error: insertError } = await supabase
      .from("prickle_types")
      .insert({
        name: name.trim(),
        normalized_name: normalizedName,
        description: description?.trim() || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating prickle type:", insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ prickleType }, { status: 201 });
  } catch (error: any) {
    console.error("Error in create prickle type route:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
