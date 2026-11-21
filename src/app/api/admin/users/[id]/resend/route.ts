import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/data/database.types";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient<Database>(url, key, {
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

  const authUsers = createRepos(supabase).authUsers;
  let user;
  try {
    user = await authUsers.byId(id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "User not found" }, { status: 404 });
  }
  if (!user?.email) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (user.confirmed) {
    return NextResponse.json({ error: "User has already accepted their invite" }, { status: 400 });
  }

  try {
    await authUsers.invite(user.email);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to resend invite" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
