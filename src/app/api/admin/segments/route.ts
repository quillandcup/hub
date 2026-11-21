import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    return NextResponse.json({ segments: await createRepos(supabase).segments.list() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load segments" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { name } = parsed;
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    const segment = await createRepos(supabase).segments.create(
      name.trim(),
      user.id !== "service-role" && user.id !== "cron" ? user.id : null
    );
    return NextResponse.json({ segment: { ...segment, memberCount: 0 } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the segment" }, { status: 400 });
  }
}
