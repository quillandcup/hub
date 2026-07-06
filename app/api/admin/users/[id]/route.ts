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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { role, features } = await request.json();

  const supabase = getServiceClient();
  if (role !== undefined) {
    await supabase.from("user_profiles").update({ role }).eq("id", id);
  }

  if (features !== undefined) {
    await supabase.from("user_feature_previews").delete().eq("user_id", id);
    if ((features as string[]).length > 0) {
      await supabase.from("user_feature_previews").insert(
        (features as string[]).map((key) => ({ user_id: id, feature_key: key }))
      );
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  if (auth.user.id === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase.auth.admin.deleteUser(id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
