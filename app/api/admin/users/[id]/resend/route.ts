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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = getServiceClient();

  const { data: userData, error: getError } = await supabase.auth.admin.getUserById(id);
  if (getError || !userData?.user?.email) {
    return NextResponse.json({ error: getError?.message ?? "User not found" }, { status: 404 });
  }

  if (userData.user.email_confirmed_at) {
    return NextResponse.json({ error: "User has already accepted their invite" }, { status: 400 });
  }

  const { error } = await supabase.auth.admin.inviteUserByEmail(userData.user.email);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
