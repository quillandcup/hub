import { requireAdmin } from "@/lib/supabase/api-auth";
import { createClient as createServiceClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// members can exceed Supabase's default 1000-row query limit (former members
// are retained, not deleted — see CLAUDE.md), and this endpoint needs the
// full table both to resolve every user's linked member and to let the
// frontend offer every unlinked member as a link target. Paginate to avoid
// silently truncating to the first 1000 rows.
async function fetchAllMembers(supabase: SupabaseClient) {
  const allMembers: { id: string; name: string; email: string; user_id: string | null }[] = [];
  let offset = 0;
  const BATCH_SIZE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from("members")
      .select("id, name, email, user_id")
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw error;

    if (batch && batch.length > 0) {
      allMembers.push(...batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allMembers;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServiceClient();

  const [
    { data: listData, error: listError },
    { data: profiles },
    { data: previews },
    { data: allStaff },
    allMembers,
  ] = await Promise.all([
    supabase.auth.admin.listUsers({ perPage: 1000 }),
    supabase.from("user_profiles").select("id, email, role, created_at"),
    supabase.from("user_feature_previews").select("user_id, feature_key"),
    supabase.from("staff").select("id, name, email, role, member_id"),
    fetchAllMembers(supabase),
  ]);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const featureMap = new Map<string, string[]>();
  for (const row of previews ?? []) {
    if (!featureMap.has(row.user_id)) featureMap.set(row.user_id, []);
    featureMap.get(row.user_id)!.push(row.feature_key);
  }
  const staffByMemberId = new Map((allStaff ?? []).filter((s) => s.member_id).map((s) => [s.member_id, s]));
  const memberByUserId = new Map((allMembers ?? []).filter((m) => m.user_id).map((m) => [m.user_id, m]));

  const users = (listData?.users ?? []).map((u) => {
    const profile = profileMap.get(u.id);
    const member = memberByUserId.get(u.id);
    const staff = member ? staffByMemberId.get(member.id) : undefined;
    return {
      id: u.id,
      email: u.email ?? "",
      role: profile?.role ?? "member",
      features: featureMap.get(u.id) ?? [],
      createdAt: u.created_at,
      staffName: staff?.name ?? null,
      staffRole: staff?.role ?? null,
      memberId: member?.id ?? null,
      memberName: member?.name ?? null,
      pending: !u.email_confirmed_at,
    };
  });

  users.sort((a, b) => a.email.localeCompare(b.email));

  return NextResponse.json({ users, allMembers: allMembers ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email } = await request.json();
  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email.trim().toLowerCase());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Link this new auth user to any existing member with a matching email —
  // otherwise members.user_id only ever gets set via the staff-merge step
  // (app/api/process/members) or manual admin linking, leaving it null for
  // an ordinary invited member indefinitely. Best-effort: a missing member
  // row (e.g. inviting a staff-only email) is not an error here.
  await supabase
    .from("members")
    .update({ user_id: data.user.id })
    .eq("email", data.user.email)
    .is("user_id", null);

  return NextResponse.json({ user: { id: data.user.id, email: data.user.email } });
}
