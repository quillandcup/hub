import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { isId } from "@/lib/ids";
import { describeOwnedRows, type OwnedDataEntry } from "@/lib/member-merge-coverage";
import { NextRequest, NextResponse } from "next/server";

export interface MemberOwnedData {
  entries: OwnedDataEntry[];
}

/**
 * GET /api/admin/members/[id]/owned-data
 *
 * What a member owns, table by table, and what a merge would do with each (moved to the member that is kept,
 * or lost with the duplicate). The merge dialog shows it for the duplicate before the merge, which cannot be undone.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!isId(id, "mbr")) return NextResponse.json({ error: "Invalid member id" }, { status: 400 });

  const repos = createRepos(auth.supabase);
  if (!(await repos.members.byId(id))) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  try {
    const entries = describeOwnedRows(await repos.members.ownedRowCounts(id));
    return NextResponse.json({ entries } satisfies MemberOwnedData);
  } catch (error) {
    console.error("Error counting a member's data:", error);
    return NextResponse.json({ error: "Failed to count the member's data" }, { status: 500 });
  }
}
