import { createApiAuth } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { supabase, user } = await createApiAuth(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: overrides, error } = await supabase
    .from("member_status_overrides")
    .select(`
      *,
      member:members(id, name, email)
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching member overrides:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ overrides });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await createApiAuth(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { member_id, override_type, reason, notes, starts_at, expires_at } = body;

    if (!member_id || !override_type || !reason) {
      return NextResponse.json(
        { error: "Missing required fields: member_id, override_type, reason" },
        { status: 400 }
      );
    }

    if (!['hiatus', 'gift', 'special'].includes(override_type)) {
      return NextResponse.json(
        { error: "override_type must be one of: hiatus, gift, special" },
        { status: 400 }
      );
    }

    const { data: override, error } = await supabase
      .from("member_status_overrides")
      .insert({
        member_id,
        override_type,
        reason,
        notes,
        starts_at,
        expires_at,
        created_by: user.id !== "service-role" ? user.id : null,
      })
      .select(`
        *,
        member:members(id, name, email)
      `)
      .single();

    if (error) {
      console.error("Error creating member override:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ override }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create override" },
      { status: 500 }
    );
  }
}
