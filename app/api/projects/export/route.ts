import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** CSV export of the acting member's own entries -- optionally scoped to one project via ?projectId=. Low-effort off-ramp: a member can always take their data with them. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return NextResponse.json({ error: "No member record" }, { status: 404 });

  const projectId = request.nextUrl.searchParams.get("projectId");

  let query = supabase
    .from("writing_progress_entries")
    .select("entry_date, measure, mode, amount, note, tags, writing_projects(title)")
    .eq("member_id", effectiveIdentity.memberId)
    .order("entry_date", { ascending: true });
  if (projectId) query = query.eq("project_id", projectId);

  const { data: entries, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = ["date", "project", "measure", "mode", "amount", "note", "tags"];
  const rows = (entries ?? []).map((e) => {
    const project = Array.isArray(e.writing_projects) ? e.writing_projects[0] : e.writing_projects;
    return [
      e.entry_date,
      project?.title ?? "",
      e.measure,
      e.mode,
      String(e.amount),
      e.note ?? "",
      (e.tags ?? []).join(";"),
    ]
      .map(csvEscape)
      .join(",");
  });

  const csv = [header.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="writing-progress${projectId ? "" : "-all-projects"}.csv"`,
    },
  });
}
