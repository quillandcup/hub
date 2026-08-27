import { NextRequest, NextResponse } from "next/server";
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

  let query = supabase
    .from("feedback")
    .select("*, member:members(name, email)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) {
    console.error("Failed to load feedback:", error);
    return NextResponse.json({ error: "Failed to load feedback" }, { status: 500 });
  }

  const userIds = Array.from(new Set((data ?? []).map((row) => row.user_id)));
  const { data: profiles } = userIds.length
    ? await supabase.from("user_profiles").select("id, email").in("id", userIds)
    : { data: [] };
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email as string]));

  const items = await Promise.all(
    (data ?? []).map(async (row) => {
      let screenshotUrl: string | null = null;
      if (row.screenshot_path) {
        const { data: signed } = await supabase.storage
          .from("feedback-screenshots")
          .createSignedUrl(row.screenshot_path, SIGNED_URL_TTL_SECONDS);
        screenshotUrl = signed?.signedUrl ?? null;
      }
      return {
        ...row,
        submitter_email: emailById.get(row.user_id) ?? null,
        screenshot_url: screenshotUrl,
      };
    })
  );

  return NextResponse.json({ items, total: count ?? items.length, page, pageSize: PAGE_SIZE });
}
