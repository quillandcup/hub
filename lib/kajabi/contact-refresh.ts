import type { SupabaseClient } from "@supabase/supabase-js";
import { toKajabiContactBronzeRecord, type KajabiClient, type KajabiContact } from "@/lib/kajabi/client";

/**
 * Targeted Bronze refresh for a single Kajabi contact.
 *
 * Re-fetches the contact from Kajabi (with tags, same shape as the full
 * import) and UPSERTs it into bronze.kajabi_contacts on kajabi_contact_id —
 * exactly the write /api/import/kajabi makes for every contact, so it's
 * idempotent and a later full sync simply overwrites it. Silver `members`
 * is NOT touched here; callers run the normal member processing afterwards
 * (triggerReprocessing("kajabi_contacts", "bronze")).
 */
export async function refreshKajabiContactInBronze(
  serviceClient: SupabaseClient,
  kajabi: Pick<KajabiClient, "fetchContact">,
  contactId: string
): Promise<KajabiContact> {
  const contact = await kajabi.fetchContact(contactId);
  const record = toKajabiContactBronzeRecord(contact, new Date().toISOString());

  const { error } = await serviceClient
    .schema("bronze")
    .from("kajabi_contacts")
    .upsert([record], { onConflict: "kajabi_contact_id" });

  if (error) {
    throw new Error(`kajabi_contacts refresh failed: ${error.message}`);
  }
  return contact;
}
