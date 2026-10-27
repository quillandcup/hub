import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createKajabiClient } from "@/lib/kajabi/client";
import { refreshKajabiContactInBronze } from "@/lib/kajabi/contact-refresh";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { adminNameAliasConflictMessage, findNameAliasConflict } from "@/lib/name-alias-conflict";
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

  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const body = parsed;
  const { name, keepOldNameAsPenName, newPenName, displayName, email, newEmailAlias, emailAlias, nameAlias } = body as {
    name?: string;
    keepOldNameAsPenName?: boolean;
    newPenName?: string;
    displayName?: string | null;
    email?: string;
    newEmailAlias?: string;
    emailAlias?: { id: string; active: boolean };
    nameAlias?: { id: string; active: boolean };
  };

  const found = await createRepos(supabase).members.byId(id);
  if (!found) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  const member: MemberRow = { id: found.id, name: found.name, email: found.email, kajabi_id: found.kajabiId };

  if (typeof name === "string") {
    const trimmed = name.trim();
    if (!trimmed) return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });

    if (trimmed !== member.name) {
      // Keeping the old name as a pen name must not take it from someone else (the upsert below
      // would reassign it): check before anything is changed in Kajabi.
      if (keepOldNameAsPenName) {
        const checked = await findNameAliasConflict(member.id, member.name);
        if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 500 });
        if (checked.conflict && checked.conflict.kind !== "own" && checked.conflict.kind !== "own_inactive") {
          return NextResponse.json({ error: adminNameAliasConflictMessage(member.name, checked.conflict) }, { status: 409 });
        }
      }

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
        try {
          await createRepos(supabase).aliases.upsertName(member.id, member.name, "admin");
        } catch (err) {
          return NextResponse.json({ error: (err as Error).message }, { status: 500 });
        }
      }

      try {
        await createRepos(supabase).members.setName(member.id, trimmed, keepOldNameAsPenName ? { displayName: member.name } : {});
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
      }
    }
  }

  if (typeof newPenName === "string" && newPenName.trim()) {
    const checked = await findNameAliasConflict(member.id, newPenName.trim());
    if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 500 });
    if (checked.conflict) {
      return NextResponse.json({ error: adminNameAliasConflictMessage(newPenName.trim(), checked.conflict) }, { status: 409 });
    }

    try {
      const added = await createRepos(supabase).aliases.addName(member.id, newPenName.trim(), "admin");
      if (!added) return NextResponse.json({ error: "That name is already linked to another member" }, { status: 409 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  if (displayName !== undefined) {
    if (displayName !== null) {
      const aliasRow = await createRepos(supabase).aliases.findName(member.id, displayName);
      if (!aliasRow) {
        return NextResponse.json({ error: "That pen name isn't on file for this member" }, { status: 400 });
      }
      // An inactive name no longer matches anything, so it can't be what the community sees either.
      if (!aliasRow.active) {
        return NextResponse.json({ error: "That pen name is inactive. Reactivate it first." }, { status: 400 });
      }
    }

    try {
      await createRepos(supabase).members.setDisplayName(member.id, displayName);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
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
    let updated: boolean;
    try {
      updated = await createRepos(supabase).aliases.setEmailActive(member.id, emailAlias.id, emailAlias.active);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
    if (!updated) return NextResponse.json({ error: "That email alias isn't on file for this member" }, { status: 404 });
    // Same as the member's own Settings toggle: reactivating backfills recent
    // matching; deactivating leaves history alone until it's reprocessed.
    if (emailAlias.active) scheduleAliasReprocess();
  }

  if (nameAlias && typeof nameAlias.id === "string" && typeof nameAlias.active === "boolean") {
    let updated: boolean;
    try {
      updated = await createRepos(supabase).aliases.setNameActive(member.id, nameAlias.id, nameAlias.active);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
    if (!updated) return NextResponse.json({ error: "That pen name isn't on file for this member" }, { status: 404 });
    // Reactivating backfills recent matching, same as the email toggle above.
    if (nameAlias.active) scheduleAliasReprocess("member_name_aliases");
  }

  const repos = createRepos(supabase);
  const [updated, names, emails] = await Promise.all([repos.members.byId(member.id), repos.aliases.namesOf(member.id), repos.aliases.emailsOf(member.id)]);
  const aliases = names.map(({ id, alias, source, active }) => ({ id, alias, source, active }));
  const emailAliases = emails
    .map(({ id, alias_email, source, active }) => ({ id, alias_email, source, active }))
    .sort((a, b) => (a.alias_email < b.alias_email ? -1 : a.alias_email > b.alias_email ? 1 : 0));

  const updatedMember = updated && { name: updated.name, display_name: updated.displayName, email: updated.email };
  return NextResponse.json({ member: updatedMember, aliases, emailAliases });
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
  const [holder, alias] = await Promise.all([createRepos(supabase).members.byEmail(address), createRepos(supabase).aliases.findEmail(address)]);
  if (holder && holder.id !== memberId) return { memberId: holder.id, as: "email" as const };
  if (alias && alias.memberId !== memberId) return { memberId: alias.memberId, as: "alias" as const };
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

  try {
    const changed = await createRepos(supabase).members.setEmail(member.id, address);
    if (!changed.ok) {
      return NextResponse.json({ error: "Another member already has that email." }, { status: 409 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // The new address may have been an alias of this member; it's the email now.
  try {
    const aliases = createRepos(supabase).aliases;
    await aliases.removeEmailOf(member.id, address);
    await aliases.upsertEmail(member.id, member.email.toLowerCase(), "manual", true);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

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

  try {
    const added = await createRepos(supabase).aliases.addEmail(member.id, address, "manual");
    if (!added) return NextResponse.json({ error: "That email is already an alias of this member" }, { status: 409 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  scheduleAliasReprocess();
  return null;
}

/** Rematch recent attendance and activity against the changed emails. */
function scheduleAliasReprocess(table: "member_email_aliases" | "member_name_aliases" = "member_email_aliases") {
  after(async () => {
    try {
      await triggerReprocessing(table, "local");
    } catch (err) {
      console.error(`[admin] Reprocessing after a ${table} change failed:`, err);
    }
  });
}
