import { requireApiPermission } from "@/lib/supabase/api-auth";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { RoleChangeRefused } from "@/lib/data/profiles";
import { roleChangeRefusal } from "@/lib/permissions";
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
    // Who may change which role: an actor changes only roles below their own highest, on people below it (an admin: any); nobody
    // removes their own admin role or the last admin. The database enforces it too (`enforce_user_role_changes`); this answers
    // first with the reason. The service key and cron (scripts) are exempt, as in the database.
    const scripted = auth.user.id === "service-role" || auth.user.id === "cron";
    if (!scripted) {
      const profiles = createRepos(supabase).profiles;
      const [actorRoles, targetRoles, adminIds] = await Promise.all([profiles.rolesOf(auth.user.id), profiles.rolesOf(id), profiles.adminIds()]);
      const refusal = roleChangeRefusal({ actor: actorRoles, target: targetRoles, next: roles as string[], self: auth.user.id === id, otherAdmins: adminIds.filter((a) => a !== id).length });
      if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
    }
    try {
      await createRepos(auth.supabase).profiles.setRoles(id, roles as string[]);
    } catch (error) {
      console.error("Updating the roles failed:", error);
      return NextResponse.json({ error: error instanceof Error ? error.message : "Updating the roles failed" }, { status: error instanceof RoleChangeRefused ? 403 : 400 });
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
  // Deleting an account takes its roles with it, so the same rules apply: an assistant can't delete an admin or another assistant,
  // and the last admin stays. The service key and cron (scripts) are exempt.
  if (auth.user.id !== "service-role" && auth.user.id !== "cron") {
    const profiles = createRepos(supabase).profiles;
    const [actorRoles, targetRoles, adminIds] = await Promise.all([profiles.rolesOf(auth.user.id), profiles.rolesOf(id), profiles.adminIds()]);
    const refusal = roleChangeRefusal({ actor: actorRoles, target: targetRoles, next: [], self: false, otherAdmins: adminIds.filter((a) => a !== id).length });
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  }
  try {
    await createRepos(supabase).authUsers.delete(id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete user" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
