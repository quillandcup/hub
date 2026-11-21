import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { key } = await params;
  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { enabledGlobally } = parsed;

  if (typeof enabledGlobally !== "boolean") {
    return NextResponse.json({ error: "enabledGlobally must be a boolean" }, { status: 400 });
  }

  try {
    await createRepos(supabase).featureFlags.setGlobal(key, enabledGlobally);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the flag" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
