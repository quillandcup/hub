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

  const { data: alias, error: fetchError } = await supabase
    .from("member_name_aliases")
    .select("id, member_id, alias")
    .eq("id", id)
    .single();

  if (fetchError || !alias) {
    return NextResponse.json({ error: fetchError?.message ?? "Alias not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase.from("member_name_aliases").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  // The deleted alias may have been the member's default display name --
  // display_name is a plain text column, not a foreign key, so it won't be
  // cleared automatically.
  await supabase
    .from("members")
    .update({ display_name: null })
    .eq("id", alias.member_id)
    .eq("display_name", alias.alias);

  return NextResponse.json({ success: true });
}
