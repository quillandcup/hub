import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";
import { normalizePrickleType } from "@/lib/prickle-types";

/**
 * Update an existing prickle type
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { typeId, name, description, purpose, soloTaskFriendly } = body;

    if (!typeId || !name) {
      return NextResponse.json(
        { error: "Missing required fields: typeId and name" },
        { status: 400 }
      );
    }

    const VALID_PURPOSES = ["writing", "work", "social", "mixed"];
    if (purpose !== undefined && !VALID_PURPOSES.includes(purpose)) {
      return NextResponse.json(
        { error: `Invalid purpose. Must be one of: ${VALID_PURPOSES.join(", ")}` },
        { status: 400 }
      );
    }
    if (soloTaskFriendly !== undefined && typeof soloTaskFriendly !== "boolean") {
      return NextResponse.json(
        { error: "soloTaskFriendly must be a boolean" },
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
        ...(purpose !== undefined ? { purpose } : {}),
        ...(soloTaskFriendly !== undefined ? { solo_task_friendly: soloTaskFriendly } : {}),
      })
      .eq("id", typeId);

    if (updateError) {
      console.error("Error updating prickle type:", updateError);
      return NextResponse.json(
        { error: "Failed to update prickle type" },
        { status: 500 }
      );
    }

    // Auto-trigger calendar prickles reprocessing (last 90 days)
    console.log('Triggering calendar reprocessing from prickle_types change');
    await triggerReprocessing('prickle_types', 'local');

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
