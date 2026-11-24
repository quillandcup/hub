import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { requireApiPermission } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Undo: removes the not-attending mark, so the buyer is listed as missing from the roster again.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const auth = await requireApiPermission(request, "events.manage");
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, memberId } = await params;
  if (!isId(memberId, "mbr")) return NextResponse.json({ error: "Invalid memberId" }, { status: 400 });

  try {
    if (!(await createRepos(auth.supabase).events.unmarkNotAttending(id, memberId))) {
      return NextResponse.json({ error: "No such mark" }, { status: 404 });
    }
  } catch (error) {
    console.error("Error removing a not-attending mark:", error);
    return NextResponse.json({ error: "Failed to remove the mark" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
