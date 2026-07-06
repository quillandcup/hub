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

  const [{ data: listData, error: listError }, { data: profiles }, { data: previews }] =
    await Promise.all([
      supabase.auth.admin.listUsers({ perPage: 1000 }),
      supabase.from("user_profiles").select("id, email, role, created_at"),
      supabase.from("user_feature_previews").select("user_id, feature_key"),
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

  const users = (listData?.users ?? []).map((u) => {
    const profile = profileMap.get(u.id);
    return {
      id: u.id,
      email: u.email ?? "",
      role: profile?.role ?? "member",
      features: featureMap.get(u.id) ?? [],
      createdAt: u.created_at,
    };
  });

  users.sort((a, b) => a.email.localeCompare(b.email));

  return NextResponse.json({ users });
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
