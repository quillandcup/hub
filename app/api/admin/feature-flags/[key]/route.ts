import { requireAdmin } from "@/lib/supabase/api-auth";
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
  const { enabledGlobally } = await request.json();

  if (typeof enabledGlobally !== "boolean") {
    return NextResponse.json({ error: "enabledGlobally must be a boolean" }, { status: 400 });
  }

  const { error } = await supabase
    .from("feature_flags")
    .upsert({ feature_key: key, enabled_globally: enabledGlobally }, { onConflict: "feature_key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
