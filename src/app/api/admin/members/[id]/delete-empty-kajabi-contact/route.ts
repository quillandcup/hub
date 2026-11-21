import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createKajabiClient, isEmptyContact } from "@/lib/kajabi/client";
import { normalizeEmail } from "@/lib/member-email";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/members/[id]/delete-empty-kajabi-contact  { contactId, email }
 *
 * Kajabi keeps emails unique and has no merge call, so a stray contact holding the address a member is
 * being moved to blocks the change. When that contact is a true leftover, this deletes it in Kajabi (it
 * cannot be undone) so the change can go through. Every check is made here, not trusted from the page:
 * the contact must not be the member's own, must not be linked to any member, must have the given email
 * in Kajabi right now, and Kajabi must say nothing is attached (no customer record, tags or offers).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const body = (await request.json().catch(() => undefined)) as { contactId?: unknown; email?: unknown } | undefined;
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
  if (!contactId || !email) return NextResponse.json({ error: "A Kajabi contact and an email are needed" }, { status: 400 });

  const repos = createRepos(auth.supabase);
  const member = await repos.members.byId(id);
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (contactId === member.kajabiId) return NextResponse.json({ error: "That is this member's own Kajabi contact" }, { status: 400 });

  const linked = await repos.members.byKajabiId(contactId);
  if (linked) return NextResponse.json({ error: "That Kajabi contact is linked to a member here, so it isn't deleted. Merge the contacts in Kajabi instead." }, { status: 409 });

  const kajabi = createKajabiClient();
  let contact;
  try {
    contact = await kajabi.fetchContactWithAttachments(contactId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read the contact in Kajabi" }, { status: 502 });
  }
  if (contact.attributes.email?.trim().toLowerCase() !== email) {
    return NextResponse.json({ error: "That Kajabi contact doesn't have that email, so it isn't deleted." }, { status: 409 });
  }
  if (!isEmptyContact(contact)) {
    return NextResponse.json({ error: "That Kajabi contact has a customer record, tags or offers, so it isn't deleted. Merge it in Kajabi instead." }, { status: 409 });
  }

  try {
    await kajabi.deleteContact(contactId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't delete the contact in Kajabi" }, { status: 502 });
  }
  console.log(`[admin] Deleted empty Kajabi contact ${contactId} (a duplicate holding an email for member ${member.id})`);

  // Kajabi no longer has it; drop the Bronze copy so the member's change (and a reprocess) don't see it.
  try {
    await createRepos(createServiceRoleClient()).billing.deleteKajabiContact(contactId);
  } catch (err) {
    console.error("[admin] Bronze copy of the deleted Kajabi contact couldn't be removed:", err);
  }
  return NextResponse.json({ ok: true });
}
