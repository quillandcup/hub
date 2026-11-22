import { requireApiPermission } from "@/lib/supabase/api-auth";
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
  const auth = await requireApiPermission(request, "system.users.manage");
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const body = parsed;
  const { role, features, memberId } = body;

  const supabase = getServiceClient();

  // Roles: a person can hold several (`roles`); `role` (one) is still accepted. The change goes through the signed-in
  // person's own client, so the Activity Log names who assigned it (the service role would be recorded as the system).
  // A refused or failed assignment is an error here, not a silent success.
  const roles: unknown = body.roles ?? (role === undefined ? undefined : [role]);
  if (roles !== undefined) {
    if (!Array.isArray(roles) || roles.some((r) => typeof r !== "string")) return NextResponse.json({ error: "roles must be a list of role names" }, { status: 400 });
    try {
      await createRepos(auth.supabase).profiles.setRoles(id, roles as string[]);
    } catch (error) {
      console.error("Updating the roles failed:", error);
      return NextResponse.json({ error: error instanceof Error ? error.message : "Updating the roles failed" }, { status: 400 });
    }
  }

  const tasks: PromiseLike<unknown>[] = [];

  if (features !== undefined) {
    tasks.push(
      createRepos(supabase)
        .featureFlags.replacePreviews(id, features as string[])
        .catch((error) => console.error("Updating the feature previews failed:", error))
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
  const auth = await requireApiPermission(request, "system.users.manage");
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  if (auth.user.id === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const supabase = getServiceClient();
  try {
    await createRepos(supabase).authUsers.delete(id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete user" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
