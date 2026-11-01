import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * DELETE /api/admin/aliases/[id]
 *
 * Admin-only hard delete of a member_name_aliases row. Unlike member
 * self-service (which only soft-deactivates, since there's no reliable way
 * to know if an alias is load-bearing for historical attendance -- see
 * migration 20260831180000_add_alias_self_service.sql), admins are trusted
 * to hard-delete outright.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const aliases = createRepos(supabase).aliases;
  let alias: Awaited<ReturnType<typeof aliases.nameById>>;
  try {
    alias = await aliases.nameById(id);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 404 });
  }
  if (!alias) return NextResponse.json({ error: "Alias not found" }, { status: 404 });

  try {
    await aliases.removeNames([id]);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  // The deleted alias may have been the member's default display name --
  // display_name is a plain text column, not a foreign key, so it won't be
  // cleared automatically.
  await createRepos(supabase).members.clearDisplayNameIfEquals(alias.memberId, alias.alias).catch(() => {});

  return NextResponse.json({ success: true });
}
