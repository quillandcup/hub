import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/zoom/ignore
 *
 * Ignore a Zoom name so it no longer appears in the unmatched list
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
    const body = await request.json();
    const { zoomName, reason } = body;

    if (!zoomName) {
      return NextResponse.json(
        { error: "zoomName is required" },
        { status: 400 }
      );
    }

    // Insert into ignored list
    const { error } = await supabase
      .from("ignored_zoom_names")
      .insert({
        zoom_name: zoomName,
        reason: reason || null,
        ignored_by: user.id,
      });

    if (error) {
      console.error("Error ignoring Zoom name:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in ignore route:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/zoom/ignore
 *
 * Un-ignore a Zoom name
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { zoomName } = body;

    if (!zoomName) {
      return NextResponse.json(
        { error: "zoomName is required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("ignored_zoom_names")
      .delete()
      .eq("zoom_name", zoomName);

    if (error) {
      console.error("Error un-ignoring Zoom name:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in un-ignore route:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
