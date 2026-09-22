import { requireAdmin } from "@/lib/supabase/api-auth";
import { fetchAllRows, chunk } from "@/lib/supabase/paginate";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type InviteStatus = "invited" | "skipped" | "failed";

interface InviteResult {
  email: string;
  status: InviteStatus;
  error?: string;
}

/**
 * Bulk-invite every member of a segment. Resolves the segment's members,
 * skips anyone who already has an auth account (rather than erroring the
 * whole batch), and reports a per-email result so partial failures are
 * visible instead of hidden behind a single all-or-nothing response.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: segmentId } = await params;
  const supabase = getServiceClient();

  const { data: segment } = await supabase.from("segments").select("id, name").eq("id", segmentId).single();
  if (!segment) return NextResponse.json({ error: "Segment not found" }, { status: 404 });

  const memberLinks = await fetchAllRows<{ member_id: string }>((from, to) =>
    supabase.from("segment_members").select("member_id").eq("segment_id", segmentId).range(from, to)
  );
  const memberIds = memberLinks.map((m) => m.member_id);

  let segmentMembers: { id: string; email: string }[] = [];
  for (const idBatch of chunk(memberIds, 500)) {
    const { data } = await supabase.from("members").select("id, email").in("id", idBatch);
    segmentMembers = segmentMembers.concat(data ?? []);
  }

  // GoTrue's admin listUsers doesn't support filtering by email, so pull the
  // full user list once (mirrors the pattern in GET /api/admin/users) and
  // match in memory rather than doing a per-email round trip.
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });
  const existingEmails = new Set((listData?.users ?? []).map((u) => (u.email ?? "").toLowerCase()));

  const results: InviteResult[] = [];

  for (const member of segmentMembers) {
    const email = member.email.toLowerCase();
    if (existingEmails.has(email)) {
      results.push({ email, status: "skipped" });
      continue;
    }

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);
    if (error) {
      results.push({ email, status: "failed", error: error.message });
      continue;
    }

    // Best-effort link, matching POST /api/admin/users — only sets it if
    // the member doesn't already have a linked auth user.
    await supabase
      .from("members")
      .update({ user_id: data.user.id })
      .eq("id", member.id)
      .is("user_id", null);

    results.push({ email, status: "invited" });
  }

  const summary = {
    invited: results.filter((r) => r.status === "invited").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  return NextResponse.json({ results, summary });
}
