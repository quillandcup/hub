import { createApiAuth } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user } = await createApiAuth(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { override_type, reason, notes, starts_at, expires_at } = body;

    if (override_type && !['hiatus', 'gift', 'special'].includes(override_type)) {
      return NextResponse.json(
        { error: "override_type must be one of: hiatus, gift, special" },
        { status: 400 }
      );
    }

    const updates: any = {};
    if (override_type !== undefined) updates.override_type = override_type;
    if (reason !== undefined) updates.reason = reason;
    if (notes !== undefined) updates.notes = notes;
    if (starts_at !== undefined) updates.starts_at = starts_at;
    if (expires_at !== undefined) updates.expires_at = expires_at;

    const { data: override, error } = await supabase
      .from("member_status_overrides")
      .update(updates)
      .eq("id", id)
      .select(`
        *,
        member:members(id, name, email)
      `)
      .single();

    if (error) {
      console.error("Error updating member override:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!override) {
      return NextResponse.json(
        { error: "Override not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ override });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update override" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user } = await createApiAuth(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const { error } = await supabase
      .from("member_status_overrides")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting member override:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete override" },
      { status: 500 }
    );
  }
}
