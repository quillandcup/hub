import { requireAdmin } from "@/lib/supabase/api-auth";
import { createKajabiClient } from "@/lib/kajabi/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/admin/members/[id]
 *
 * Admin-only editing of a member's legal name and default pen name.
 *
 * Legal name changes push to Kajabi first (when the member has a kajabi_id --
 * some staff do, some don't) since reprocess_members_atomic overwrites
 * members.name from Kajabi's contact.name on every full reprocess; a
 * local-only edit would silently get reverted. If the Kajabi push fails, the
 * local row is left untouched to avoid drifting out of sync with the source
 * of truth.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const body = await request.json();
  const { name, keepOldNameAsPenName, newPenName, displayName } = body as {
    name?: string;
    keepOldNameAsPenName?: boolean;
    newPenName?: string;
    displayName?: string | null;
  };

  const { data: member, error: fetchError } = await supabase
    .from("members")
    .select("id, name, kajabi_id")
    .eq("id", id)
    .single();

  if (fetchError || !member) {
    return NextResponse.json({ error: fetchError?.message ?? "Member not found" }, { status: 404 });
  }

  if (typeof name === "string") {
    const trimmed = name.trim();
    if (!trimmed) return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });

    if (trimmed !== member.name) {
      if (member.kajabi_id) {
        try {
          await createKajabiClient().updateContact(member.kajabi_id, { name: trimmed });
        } catch (err) {
          return NextResponse.json(
            { error: err instanceof Error ? err.message : "Couldn't update the name in Kajabi" },
            { status: 502 }
          );
        }
      }

      if (keepOldNameAsPenName) {
        const { error: aliasError } = await supabase
          .from("member_name_aliases")
          .upsert({ member_id: member.id, alias: member.name, source: "admin" }, { onConflict: "alias" });
        if (aliasError) return NextResponse.json({ error: aliasError.message }, { status: 500 });
      }

      const nameUpdate: { name: string; display_name?: string } = { name: trimmed };
      if (keepOldNameAsPenName) nameUpdate.display_name = member.name;

      const { error: updateError } = await supabase.from("members").update(nameUpdate).eq("id", member.id);
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  if (typeof newPenName === "string" && newPenName.trim()) {
    const { error: insertError } = await supabase
      .from("member_name_aliases")
      .insert({ member_id: member.id, alias: newPenName.trim(), source: "admin" });
    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "That name is already linked to another member" }, { status: 409 });
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  if (displayName !== undefined) {
    if (displayName !== null) {
      const { data: aliasRow } = await supabase
        .from("member_name_aliases")
        .select("id")
        .eq("member_id", member.id)
        .eq("alias", displayName)
        .maybeSingle();
      if (!aliasRow) {
        return NextResponse.json({ error: "That pen name isn't on file for this member" }, { status: 400 });
      }
    }

    const { error: displayNameError } = await supabase
      .from("members")
      .update({ display_name: displayName })
      .eq("id", member.id);
    if (displayNameError) return NextResponse.json({ error: displayNameError.message }, { status: 500 });
  }

  const [{ data: updatedMember }, { data: aliases }] = await Promise.all([
    supabase.from("members").select("name, display_name").eq("id", member.id).single(),
    supabase
      .from("member_name_aliases")
      .select("id, alias, source, active")
      .eq("member_id", member.id)
      .order("created_at", { ascending: false }),
  ]);

  return NextResponse.json({ member: updatedMember, aliases: aliases ?? [] });
}
