import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { normalizePrickleType } from "@/lib/prickle-types";

/**
 * Update an existing prickle type
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { typeId, name, description } = body;

    if (!typeId || !name) {
      return NextResponse.json(
        { error: "Missing required fields: typeId and name" },
        { status: 400 }
      );
    }

    // Regenerate normalized_name from the new name
    const normalizedName = normalizePrickleType(name);

    // Check if another type already has this normalized name
    const { data: existingType } = await supabase
      .from("prickle_types")
      .select("id")
      .eq("normalized_name", normalizedName)
      .neq("id", typeId)
      .single();

    if (existingType) {
      return NextResponse.json(
        { error: "A prickle type with this name already exists" },
        { status: 409 }
      );
    }

    // Update the prickle type
    const { error: updateError } = await supabase
      .from("prickle_types")
      .update({
        name: name.trim(),
        normalized_name: normalizedName,
        description: description?.trim() || null,
      })
      .eq("id", typeId);

    if (updateError) {
      console.error("Error updating prickle type:", updateError);
      return NextResponse.json(
        { error: "Failed to update prickle type" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Prickle type updated successfully",
    });
  } catch (error: any) {
    console.error("Error updating prickle type:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update prickle type" },
      { status: 500 }
    );
  }
}
