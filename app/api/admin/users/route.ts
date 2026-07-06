import { requireAdmin } from "@/lib/supabase/api-auth";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
    { data: linkedMembers },
  ] = await Promise.all([
    supabase.auth.admin.listUsers({ perPage: 1000 }),
    supabase.from("user_profiles").select("id, email, role, created_at"),
    supabase.from("user_feature_previews").select("user_id, feature_key"),
    supabase.from("staff").select("id, name, email, role, user_id"),
    supabase.from("members").select("id, name, email, user_id").not("user_id", "is", null),
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
  const staffByUserId = new Map((allStaff ?? []).filter((s) => s.user_id).map((s) => [s.user_id, s]));
  const memberByUserId = new Map((linkedMembers ?? []).map((m) => [m.user_id, m]));

  const users = (listData?.users ?? []).map((u) => {
    const profile = profileMap.get(u.id);
    const staff = staffByUserId.get(u.id);
    const member = memberByUserId.get(u.id);
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
    };
  });

  users.sort((a, b) => a.email.localeCompare(b.email));

  return NextResponse.json({ users, allStaff: allStaff ?? [] });
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

  return NextResponse.json({ user: { id: data.user.id, email: data.user.email } });
}
