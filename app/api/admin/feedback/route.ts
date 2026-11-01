import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";

const PAGE_SIZE = 50;
// Regenerated on every page load, so this only matters if an admin leaves
// the tab open longer than an hour without refreshing — a reload fixes it.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { searchParams } = new URL(request.url);
  const page = Math.max(0, parseInt(searchParams.get("page") || "0", 10) || 0);
  const status = searchParams.get("status");

  let result: Awaited<ReturnType<ReturnType<typeof createRepos>["adminWork"]["feedbackPage"]>>;
  try {
    result = await createRepos(supabase).adminWork.feedbackPage({ status: status || undefined, page, pageSize: PAGE_SIZE });
  } catch (error) {
    console.error("Failed to load feedback:", error);
    return NextResponse.json({ error: "Failed to load feedback" }, { status: 500 });
  }
  const { rows, total } = result;

  // A removed member's feedback stays without a user (docs/TODO.md, "Removal on request").
  const userIds = Array.from(new Set(rows.flatMap((row) => (row.user_id ? [row.user_id] : []))));
  const profiles = await createRepos(supabase).profiles.byIds(userIds);
  const emailById = new Map(profiles.map((p) => [p.id, p.email]));

  const items = await Promise.all(
    rows.map(async (row) => {
      let screenshotUrl: string | null = null;
      if (row.screenshot_path) {
        const { data: signed } = await supabase.storage
          .from("feedback-screenshots")
          .createSignedUrl(row.screenshot_path, SIGNED_URL_TTL_SECONDS);
        screenshotUrl = signed?.signedUrl ?? null;
      }
      return {
        ...row,
        submitter_email: row.user_id ? (emailById.get(row.user_id) ?? null) : null,
        screenshot_url: screenshotUrl,
      };
    })
  );

  return NextResponse.json({ items, total, page, pageSize: PAGE_SIZE });
}
