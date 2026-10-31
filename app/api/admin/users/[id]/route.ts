import { requireAdmin } from "@/lib/supabase/api-auth";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import type { Database } from "@/lib/data/database.types";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient<Database>(url, key, {
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
  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const body = parsed;
  const { role, features, memberId } = body;

  const supabase = getServiceClient();

  const tasks: PromiseLike<unknown>[] = [];

  if (role !== undefined) {
    tasks.push(createRepos(supabase).profiles.setRole(id, role).catch((error) => console.error("Updating the role failed:", error)));
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

  if ("memberId" in body) {
    tasks.push(
      (async () => {
        // Clear any existing member link for this user
        const members = createRepos(supabase).members;
        await members.unlinkAuthUser(id);
        if (memberId) await members.linkAuthUser(memberId, id);
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
