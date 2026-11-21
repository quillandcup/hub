import { createRepos } from "@/lib/data/repos";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { id } = await params;

  const repos = createRepos(supabase);
  const segment = await repos.segments.byId(id).catch(() => null);

  if (!segment) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  const memberIds = await repos.segments.memberIds(id);
  const members = (await repos.members.byIds(memberIds))
    .map(({ id, name, displayName, email }) => ({ id, name, displayName, email }))
    .sort((a, b) =>
      getMemberDisplayName({ name: a.name, display_name: a.displayName }).localeCompare(
        getMemberDisplayName({ name: b.name, display_name: b.displayName })
      )
    );

  return NextResponse.json({ segment, members });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { id } = await params;

  // segment_members and feature_flag_segments both cascade on delete
  try {
    await createRepos(supabase).segments.remove(id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete the segment" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
