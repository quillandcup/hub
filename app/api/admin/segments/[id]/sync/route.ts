import { createRepos } from "@/lib/data/repos";
import { isSegmentSourceType, memberIdsWithAccess } from "@/lib/segment-sources";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * Adds everyone with access to a course, program or event to the segment. Additive: members already
 * in the segment (added by hand or from another source) stay, so running it again later picks up
 * the people who got access since.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: segmentId } = await params;
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (!isSegmentSourceType(body.type) || typeof body.id !== "string" || body.id === "") {
    return NextResponse.json({ error: "Choose a course, program or event" }, { status: 400 });
  }

  const repos = createRepos(auth.supabase);
  const segment = await repos.segments.byId(segmentId).catch(() => null);
  if (!segment) return NextResponse.json({ error: "Segment not found" }, { status: 404 });

  try {
    const withAccess = await memberIdsWithAccess(repos, body.type, body.id);
    if (withAccess === null) return NextResponse.json({ error: `That ${body.type} was not found` }, { status: 404 });

    const existing = new Set(await repos.segments.memberIds(segmentId));
    const toAdd = withAccess.filter((id) => !existing.has(id));
    await repos.segments.addMembers(segmentId, toAdd);
    return NextResponse.json({ summary: { found: withAccess.length, added: toAdd.length, already_in_segment: withAccess.length - toAdd.length } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync the segment" }, { status: 500 });
  }
}
