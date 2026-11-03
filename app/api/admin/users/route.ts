import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createClient as createServiceClient, SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/data/database.types";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// members can exceed Supabase's default 1000-row query limit (former members
// are retained, not deleted — see CLAUDE.md), and this endpoint needs the
// full table both to resolve every user's linked member and to let the
// frontend offer every unlinked member as a link target. Paginate to avoid
// silently truncating to the first 1000 rows.
// Supabase Auth's listUsers is paged too (the page size is capped), so walk every page.
async function fetchAllAuthUsers(supabase: SupabaseClient) {
  const PER_PAGE = 1000;
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) return { users, error };
    users.push(...data.users);
    if (data.users.length < PER_PAGE) return { users, error: null };
  }
}

async function fetchAllMembers(supabase: SupabaseClient) {
  const members = await createRepos(supabase).members.list();
  return members.map((m) => ({ id: m.id, name: m.name, displayName: m.displayName, email: m.email, user_id: m.userId }));
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServiceClient();

  const [
    { users: authUsers, error: listError },
    profiles,
    previews,
    allStaff,
    allMembers,
  ] = await Promise.all([
    fetchAllAuthUsers(supabase),
    createRepos(supabase).profiles.all(),
    createRepos(supabase).featureFlags.allPreviews(),
    createRepos(supabase).staff.all(),
    fetchAllMembers(supabase),
  ]);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const featureMap = new Map<string, string[]>();
  for (const row of previews) {
    if (!featureMap.has(row.userId)) featureMap.set(row.userId, []);
    featureMap.get(row.userId)!.push(row.featureKey);
  }
  const staffByMemberId = new Map(allStaff.filter((s) => s.member_id).map((s) => [s.member_id, s]));
  const memberByUserId = new Map((allMembers ?? []).filter((m) => m.user_id).map((m) => [m.user_id, m]));

  const users = authUsers.map((u) => {
    const profile = profileMap.get(u.id);
    const member = memberByUserId.get(u.id);
    const staff = member ? staffByMemberId.get(member.id) : undefined;
    return {
      id: u.id,
      email: u.email ?? "",
      role: profile?.role ?? "member",
      features: featureMap.get(u.id) ?? [],
      createdAt: u.created_at,
      staffId: staff?.id ?? null,
      staffName: staff?.name ?? null,
      staffRole: staff?.role ?? null,
      memberId: member?.id ?? null,
      memberName: member?.name ?? null,
      memberDisplayName: member?.displayName ?? null,
      pending: !u.email_confirmed_at,
      // A ban (banned_until in the future) stops sign-in and token refresh; it is how access is held back or removed.
      bannedUntil: u.banned_until && new Date(u.banned_until).getTime() > Date.now() ? u.banned_until : null,
    };
  });

  users.sort((a, b) => a.email.localeCompare(b.email));

  return NextResponse.json({ users, allMembers: allMembers ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { email } = parsed;
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
  if (data.user.email) {
    await createRepos(supabase).members.linkAuthUserByEmail(data.user.email, data.user.id).catch(() => {});
  }

  return NextResponse.json({ user: { id: data.user.id, email: data.user.email } });
}
