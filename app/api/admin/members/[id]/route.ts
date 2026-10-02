import { requireAdmin } from "@/lib/supabase/api-auth";
import { createKajabiClient } from "@/lib/kajabi/client";
import { refreshKajabiContactInBronze } from "@/lib/kajabi/contact-refresh";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * PATCH /api/admin/members/[id]
 *
 * Admin-only editing of a member's legal name, default pen name, primary
 * email and email aliases.
 *
 * Legal name changes push to Kajabi first (when the member has a kajabi_id --
 * some staff do, some don't) since reprocess_members_atomic overwrites
 * members.name from Kajabi's contact.name on every full reprocess; a
 * local-only edit would silently get reverted. If the Kajabi push fails, the
 * local row is left untouched to avoid drifting out of sync with the source
 * of truth. Primary email changes work the same way (members.email follows
 * the Kajabi contact's email on every reprocess).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const body = await request.json();
  const { name, keepOldNameAsPenName, newPenName, displayName, email, newEmailAlias, emailAlias } = body as {
    name?: string;
    keepOldNameAsPenName?: boolean;
    newPenName?: string;
    displayName?: string | null;
    email?: string;
    newEmailAlias?: string;
    emailAlias?: { id: string; active: boolean };
  };

  const { data: member, error: fetchError } = await supabase
    .from("members")
    .select("id, name, email, kajabi_id")
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

  if (typeof email === "string") {
    const result = await changePrimaryEmail(supabase, member, email);
    if (result) return result;
  }

  if (typeof newEmailAlias === "string") {
    const result = await addEmailAlias(supabase, member, newEmailAlias);
    if (result) return result;
  }

  if (emailAlias && typeof emailAlias.id === "string" && typeof emailAlias.active === "boolean") {
    const { data: updated, error: aliasError } = await supabase
      .from("member_email_aliases")
      .update({ active: emailAlias.active })
      .eq("id", emailAlias.id)
      .eq("member_id", member.id)
      .select("id")
      .maybeSingle();
    if (aliasError) return NextResponse.json({ error: aliasError.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "That email alias isn't on file for this member" }, { status: 404 });
    // Same as the member's own Settings toggle: reactivating backfills recent
    // matching; deactivating leaves history alone until it's reprocessed.
    if (emailAlias.active) scheduleAliasReprocess();
  }

  const [{ data: updatedMember }, { data: aliases }, { data: emailAliases }] = await Promise.all([
    supabase.from("members").select("name, display_name, email").eq("id", member.id).single(),
    supabase
      .from("member_name_aliases")
      .select("id, alias, source, active")
      .eq("member_id", member.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("member_email_aliases")
      .select("id, alias_email, source, active")
      .eq("member_id", member.id)
      .order("alias_email"),
  ]);

  return NextResponse.json({ member: updatedMember, aliases: aliases ?? [], emailAliases: emailAliases ?? [] });
}

type MemberRow = { id: string; name: string; email: string; kajabi_id: string | null };

function normalizeEmail(input: string): string | NextResponse {
  const normalized = input.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  return normalized;
}

/**
 * Another member who already has this address, as their email or an alias.
 * Two members sharing an address is a duplicate to merge, not something to
 * paper over with an alias.
 */
async function findEmailOwner(supabase: SupabaseClient, memberId: string, address: string) {
  const [{ data: holder }, { data: alias }] = await Promise.all([
    supabase.from("members").select("id").eq("email", address).neq("id", memberId).maybeSingle(),
    supabase.from("member_email_aliases").select("member_id").eq("alias_email", address).maybeSingle(),
  ]);
  if (holder) return { memberId: holder.id as string, as: "email" as const };
  if (alias && alias.member_id !== memberId) return { memberId: alias.member_id as string, as: "alias" as const };
  return null;
}

function conflictResponse(owner: { memberId: string; as: "email" | "alias" }) {
  return NextResponse.json(
    {
      error:
        owner.as === "email"
          ? "Another member already has that email. If they're the same person, merge them instead."
          : "That email is already an alias of another member. If they're the same person, merge them instead.",
      conflictingMemberId: owner.memberId,
    },
    { status: 409 }
  );
}

/**
 * Change the member's primary email. With a Kajabi contact, Kajabi goes first
 * (the next reprocess would otherwise put the Kajabi email back), then Bronze,
 * so a reprocess before the next full Kajabi import agrees, then the member.
 * The old email stays on as an alias, so history filed under it still matches.
 */
async function changePrimaryEmail(supabase: SupabaseClient, member: MemberRow, input: string) {
  const address = normalizeEmail(input);
  if (address instanceof NextResponse) return address;
  if (address === member.email.toLowerCase()) return null;

  const owner = await findEmailOwner(supabase, member.id, address);
  if (owner) return conflictResponse(owner);

  if (member.kajabi_id) {
    const kajabi = createKajabiClient();
    try {
      await kajabi.updateContact(member.kajabi_id, { email: address });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Couldn't update the email in Kajabi" },
        { status: 502 }
      );
    }

    const service = createServiceRoleClient();
    try {
      await refreshKajabiContactInBronze(service, kajabi, member.kajabi_id);
    } catch (err) {
      // Kajabi has the new email; make Bronze agree without the round trip.
      console.error("[admin] Kajabi contact refresh failed after email change, patching Bronze:", err);
      const { error: bronzeError } = await service
        .schema("bronze")
        .from("kajabi_contacts")
        .update({ email: address })
        .eq("kajabi_contact_id", member.kajabi_id);
      if (bronzeError) console.error("[admin] Bronze email patch failed:", bronzeError);
    }
  }

  const { error: updateError } = await supabase.from("members").update({ email: address }).eq("id", member.id);
  if (updateError) {
    if (updateError.code === "23505") {
      return NextResponse.json({ error: "Another member already has that email." }, { status: 409 });
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // The new address may have been an alias of this member; it's the email now.
  const { error: cleanupError } = await supabase
    .from("member_email_aliases")
    .delete()
    .eq("member_id", member.id)
    .eq("alias_email", address);
  if (cleanupError) return NextResponse.json({ error: cleanupError.message }, { status: 500 });

  const { error: aliasError } = await supabase
    .from("member_email_aliases")
    .upsert(
      { member_id: member.id, alias_email: member.email.toLowerCase(), source: "manual", active: true },
      { onConflict: "alias_email" }
    );
  if (aliasError) return NextResponse.json({ error: aliasError.message }, { status: 500 });

  member.email = address;
  scheduleAliasReprocess();
  return null;
}

async function addEmailAlias(supabase: SupabaseClient, member: MemberRow, input: string) {
  const address = normalizeEmail(input);
  if (address instanceof NextResponse) return address;
  if (address === member.email.toLowerCase()) {
    return NextResponse.json({ error: "That's already this member's email" }, { status: 400 });
  }

  const owner = await findEmailOwner(supabase, member.id, address);
  if (owner) return conflictResponse(owner);

  const { error } = await supabase
    .from("member_email_aliases")
    .insert({ member_id: member.id, alias_email: address, source: "manual" });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That email is already an alias of this member" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  scheduleAliasReprocess();
  return null;
}

/** Rematch recent attendance and activity against the changed emails. */
function scheduleAliasReprocess() {
  after(async () => {
    try {
      await triggerReprocessing("member_email_aliases", "local");
    } catch (err) {
      console.error("[admin] Reprocessing after an email change failed:", err);
    }
  });
}
