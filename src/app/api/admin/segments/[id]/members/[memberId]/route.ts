import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { id: segmentId, memberId } = await params;

  try {
    await createRepos(supabase).segments.removeMember(segmentId, memberId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove the member" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
