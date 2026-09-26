"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { createKajabiClient } from "@/lib/kajabi/client";
import { refreshKajabiContactInBronze } from "@/lib/kajabi/contact-refresh";
import {
  INSTAGRAM_BASE_URL,
  INSTAGRAM_CUSTOM_FIELD_HANDLE,
  parseInstagramInput,
  toSocialUrl,
} from "@/lib/kajabi/profile-fields";

/**
 * Member self-service for the Kajabi-owned public profile (bio + socials).
 *
 * Kajabi is the source of truth, so edits go Kajabi → Bronze → Silver:
 *   1. PATCH the Kajabi contact (only the "Instagram Handle" custom field is
 *      writable — Kajabi's API exposes no update for customer public_bio /
 *      socials; see lib/kajabi/profile-fields.ts),
 *   2. re-fetch that one contact into bronze.kajabi_contacts (same UPSERT as
 *      the full import),
 *   3. run the normal member processing (/api/process/members) after the
 *      response, which rebuilds members.instagram_url from Bronze.
 * Silver `members` is never written directly here.
 *
 * Sudo: allowed, same as the other Settings identity actions (e.g.
 * updateRealName also pushes to Kajabi during sudo) — the edit applies to the
 * sudo'd member, which is how an admin helps a member fix their profile.
 * Logged with the acting mode so it's traceable in Vercel logs.
 */

export interface ProfileSettings {
  memberId: string;
  /** False when the member has no Kajabi contact (e.g. staff-only records) — nothing is editable. */
  kajabiLinked: boolean;
  /** What the profile currently shows (Silver `members`). */
  bio: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  /** Kajabi "Instagram Handle" contact custom field, from the latest Bronze snapshot. */
  instagramHandle: string | null;
  /**
   * The member's native Kajabi profile has socials.instagram set, which
   * member processing ranks above the custom field — an edit here wouldn't
   * change what's shown, so the field is read-only and they're pointed to Kajabi.
   */
  instagramManagedInKajabiProfile: boolean;
  /** Bronze already has the new handle but Silver hasn't been reprocessed yet. */
  syncPending: boolean;
}

type ProfileContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      effectiveIdentity: NonNullable<Awaited<ReturnType<typeof getEffectiveIdentity>>>;
    };

async function requireIdentity(): Promise<ProfileContext> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  return { supabase, effectiveIdentity };
}

interface KajabiProfileSnapshot {
  instagramHandle: string | null;
  nativeInstagram: string | null;
}

/**
 * Read this member's Kajabi profile state from Bronze. Mirrors how
 * /api/process/members picks the customer (latest updated_at_kajabi across
 * the canonical email and its active aliases).
 */
async function loadKajabiProfileSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  service: SupabaseClient,
  kajabiId: string,
  memberEmail: string
): Promise<KajabiProfileSnapshot> {
  const { data: aliases } = await supabase
    .from("member_email_aliases")
    .select("alias_email")
    .eq("canonical_email", memberEmail)
    .eq("active", true);
  const emails = [memberEmail, ...(aliases ?? []).map((a) => a.alias_email)].map((e) => e.toLowerCase());

  const [contactResult, customersResult] = await Promise.all([
    service.schema("bronze").from("kajabi_contacts").select("data").eq("kajabi_contact_id", kajabiId).maybeSingle(),
    service.schema("bronze").from("kajabi_customers").select("data, updated_at_kajabi").in("email", emails),
  ]);
  if (contactResult.error) throw contactResult.error;
  if (customersResult.error) throw customersResult.error;

  type CustomerRow = {
    data: { attributes?: { socials?: { instagram?: string | null } | null } } | null;
    updated_at_kajabi: string;
  };
  const latestCustomer = ((customersResult.data ?? []) as CustomerRow[]).reduce<CustomerRow | null>(
    (latest, row) => (!latest || row.updated_at_kajabi > latest.updated_at_kajabi ? row : latest),
    null
  );
  const nativeInstagram = latestCustomer?.data?.attributes?.socials?.instagram;
  const handle = contactResult.data?.data?.attributes?.[INSTAGRAM_CUSTOM_FIELD_HANDLE];

  return {
    instagramHandle: typeof handle === "string" && handle.trim() ? handle.trim() : null,
    nativeInstagram: typeof nativeInstagram === "string" && nativeInstagram.trim() ? nativeInstagram.trim() : null,
  };
}

async function loadMember(ctx: Exclude<ProfileContext, { error: string }>) {
  return ctx.supabase
    .from("members")
    .select("email, kajabi_id, bio, instagram_url, facebook_url, twitter_url")
    .eq("id", ctx.effectiveIdentity.memberId)
    .single();
}

export async function getProfileSettings(): Promise<ProfileSettings | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;

  const { data: member, error } = await loadMember(ctx);
  if (error || !member) return { error: error?.message ?? "Couldn't load your profile" };

  const base = {
    memberId: ctx.effectiveIdentity.memberId,
    bio: member.bio ?? null,
    instagramUrl: member.instagram_url ?? null,
    facebookUrl: member.facebook_url ?? null,
    twitterUrl: member.twitter_url ?? null,
  };

  if (!member.kajabi_id) {
    return {
      ...base,
      kajabiLinked: false,
      instagramHandle: null,
      instagramManagedInKajabiProfile: false,
      syncPending: false,
    };
  }

  let snapshot: KajabiProfileSnapshot;
  try {
    snapshot = await loadKajabiProfileSnapshot(ctx.supabase, createServiceRoleClient(), member.kajabi_id, member.email);
  } catch (err) {
    console.error("[profile] Failed to load Kajabi Bronze snapshot for member", ctx.effectiveIdentity.memberId, err);
    return { error: "Couldn't load your Kajabi profile" };
  }

  const managedInKajabi = snapshot.nativeInstagram !== null;
  return {
    ...base,
    kajabiLinked: true,
    instagramHandle: snapshot.instagramHandle,
    instagramManagedInKajabiProfile: managedInKajabi,
    syncPending: !managedInKajabi && toSocialUrl(INSTAGRAM_BASE_URL, snapshot.instagramHandle) !== base.instagramUrl,
  };
}

export type UpdateInstagramResult = { success: true; syncPending: boolean; warning?: string } | { error: string };

export async function updateInstagramHandle(input: string): Promise<UpdateInstagramResult> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const parsed = parseInstagramInput(input);
  if ("error" in parsed) return parsed;

  const { data: member, error: memberError } = await loadMember(ctx);
  if (memberError || !member) return { error: memberError?.message ?? "Couldn't load your profile" };
  if (!member.kajabi_id) {
    return {
      error:
        "Your profile isn't linked to a Kajabi account, so it can't be edited here. Email support@quillandcup.com for help.",
    };
  }

  const service = createServiceRoleClient();
  let snapshot: KajabiProfileSnapshot;
  try {
    snapshot = await loadKajabiProfileSnapshot(supabase, service, member.kajabi_id, member.email);
  } catch (err) {
    console.error("[profile] Failed to load Kajabi Bronze snapshot for member", effectiveIdentity.memberId, err);
    return { error: "Couldn't load your Kajabi profile" };
  }

  if (snapshot.nativeInstagram !== null) {
    return {
      error: "Your Instagram comes from your Kajabi profile, which takes priority — update it in Kajabi instead.",
    };
  }

  // Unchanged: don't round-trip to Kajabi or kick off a reprocess.
  if ((snapshot.instagramHandle?.replace(/^@+/, "") ?? null) === parsed.handle) {
    return { success: true, syncPending: false };
  }

  const kajabi = createKajabiClient();
  try {
    await kajabi.updateContact(member.kajabi_id, { [INSTAGRAM_CUSTOM_FIELD_HANDLE]: parsed.handle });
  } catch (err) {
    console.error("[profile] Kajabi updateContact failed for member", effectiveIdentity.memberId, err);
    const detail = err instanceof Error ? err.message : "unknown error";
    return { error: `Couldn't save your Instagram to Kajabi (${detail}). Nothing was changed — please try again.` };
  }

  console.log(
    `[profile] Instagram handle updated in Kajabi for member ${effectiveIdentity.memberId}` +
      (effectiveIdentity.isSudo ? " (by an admin in sudo mode)" : "")
  );

  // Kajabi now has the change. Pull just this contact back into Bronze so the
  // member doesn't wait for the next full sync; if that fails, the change is
  // still safe in Kajabi and the next scheduled Kajabi sync will pick it up.
  try {
    await refreshKajabiContactInBronze(service, kajabi, member.kajabi_id);
  } catch (err) {
    console.error("[profile] Targeted Kajabi Bronze refresh failed for member", effectiveIdentity.memberId, err);
    return {
      success: true,
      syncPending: true,
      warning: "Saved to Kajabi. It may take until the next Kajabi sync to show on your profile.",
    };
  }

  // Silver: normal member processing, after the response so the member isn't
  // stuck waiting on a full members pass.
  after(async () => {
    try {
      const { processed } = await triggerReprocessing("kajabi_contacts", "bronze");
      const failed = processed.filter((r: { success: boolean }) => !r.success);
      if (failed.length > 0) console.error("[profile] Member reprocessing after Instagram edit failed:", failed);
    } catch (err) {
      console.error("[profile] Member reprocessing after Instagram edit failed:", err);
    }
  });

  revalidatePath("/settings");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true, syncPending: true };
}
