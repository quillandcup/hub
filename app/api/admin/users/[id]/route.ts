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
  const body = await request.json();
  const { role, features, staffId } = body;

  const supabase = getServiceClient();

  const tasks: PromiseLike<unknown>[] = [];

  if (role !== undefined) {
    tasks.push(supabase.from("user_profiles").update({ role }).eq("id", id));
  }

  if (features !== undefined) {
    tasks.push(
      (async () => {
        await supabase.from("user_feature_previews").delete().eq("user_id", id);
        if ((features as string[]).length > 0) {
          await supabase.from("user_feature_previews").insert(
            (features as string[]).map((key: string) => ({ user_id: id, feature_key: key }))
          );
        }
      })()
    );
  }

  if ("staffId" in body) {
    tasks.push(
      (async () => {
        // Clear any existing staff link for this user
        await Promise.all([
          supabase.from("staff").update({ user_id: null }).eq("user_id", id),
          supabase.from("members").update({ user_id: null }).eq("user_id", id),
        ]);

        if (staffId) {
          const { data: staffRecord } = await supabase
            .from("staff")
            .select("email")
            .eq("id", staffId)
            .single();

          if (staffRecord) {
            await Promise.all([
              supabase.from("staff").update({ user_id: id }).eq("id", staffId),
              supabase.from("members").update({ user_id: id }).eq("email", staffRecord.email),
            ]);
          }
        }
      })()
    );
  }

  await Promise.all(tasks);

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
