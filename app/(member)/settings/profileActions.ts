"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { createKajabiClient } from "@/lib/kajabi/client";
import { refreshKajabiContactInBronze } from "@/lib/kajabi/contact-refresh";
import {
  INSTAGRAM_BASE_URL,
  INSTAGRAM_CUSTOM_FIELD_HANDLE,
  parseInstagramInput,
  resolveInstagramUrl,
  toSocialUrl,
} from "@/lib/kajabi/profile-fields";
import { applyProfileOverride, nextOverrideValue, type ProfileFields } from "@/lib/member-profile-overrides";
import { FACEBOOK_BASE_URL, X_BASE_URL, parseBioInput, parseFacebookInput, parseXInput } from "@/lib/social-links";

/**
 * Member self-service for the public profile shown on /members/[id].
 *
 * Two ownership models, both ending in the normal member processing
 * (/api/process/members) so Silver `members` is never written directly:
 *
 * - Instagram: Kajabi owns it (the contact "Instagram Handle" custom field,
 *   which wins over the member-directory socials.instagram). Edits go
 *   Kajabi → Bronze (targeted single-contact refresh) → Silver.
 * - Bio / Facebook / X: Kajabi's API can't write customer public_bio/socials,
 *   so the Hub owns member edits to these in member_profile_overrides (Local
 *   layer, RLS: own row or admin). Per field: never set (NULL) follows
 *   Kajabi, a Hub value wins, and a field the member cleared ('') shows
 *   nothing. Kajabi's member directory is allowed to drift (product decision).
 *
 * Sudo: allowed — edits apply to the sudo'd member (effective identity), same
 * as the other Settings identity actions. The admin's own session does the
 * override write (RLS is_admin() branch) and is recorded in updated_by.
 * Logged with the acting mode so it's traceable in Vercel logs.
 */

export interface ProfileDetails {
  bio: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
}

export interface ProfileSettings {
  memberId: string;
  /** False when the member has no Kajabi contact (e.g. staff-only records) — Instagram isn't editable. */
  kajabiLinked: boolean;
  /** Kajabi "Instagram Handle" contact custom field, from the latest Bronze snapshot. */
  instagramHandle: string | null;
  /**
   * What the profile shows if the handle is left blank: the Kajabi
   * member-directory Instagram (socials.instagram), which is the fallback in
   * member processing. Null when there isn't one.
   */
  instagramFallbackUrl: string | null;
  /** Bio / Facebook / X as the profile will show them (member override, else Kajabi). */
  details: ProfileDetails;
  /** A saved change hasn't reached the profile yet (member processing still running). */
  syncPending: boolean;
}

type ProfileContext =
  | { error: string }
  | {
      user: AuthUser;
      supabase: Awaited<ReturnType<typeof createClient>>;
      service: SupabaseClient;
      effectiveIdentity: NonNullable<Awaited<ReturnType<typeof getEffectiveIdentity>>>;
    };

async function requireIdentity(): Promise<ProfileContext> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  return { user, supabase, service: createServiceRoleClient(), effectiveIdentity };
}

type Ctx = Exclude<ProfileContext, { error: string }>;

function nonBlank(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

interface KajabiProfileSnapshot {
  instagramHandle: string | null;
  socialsInstagram: string | null;
  /** Kajabi-derived bio/Facebook/X, mapped exactly like /api/process/members. */
  kajabiDetails: ProfileFields;
}

const EMPTY_DETAILS: ProfileFields = { bio: null, facebook_url: null, twitter_url: null };

/**
 * Read this member's Kajabi profile state from Bronze. Mirrors how
 * /api/process/members picks the customer (latest updated_at_kajabi across
 * the canonical email and its active aliases). Service role: Bronze and the
 * alias table aren't member-readable; every query is scoped to this member.
 */
async function loadKajabiProfileSnapshot(
  service: SupabaseClient,
  kajabiId: string,
  memberEmail: string
): Promise<KajabiProfileSnapshot> {
  const { data: aliases, error: aliasError } = await service
    .from("member_email_aliases")
    .select("alias_email")
    .eq("canonical_email", memberEmail)
    .eq("active", true);
  if (aliasError) throw aliasError;
  const emails = [memberEmail, ...(aliases ?? []).map((a) => a.alias_email)].map((e) => e.toLowerCase());

  const [contactResult, customersResult] = await Promise.all([
    service.schema("bronze").from("kajabi_contacts").select("data").eq("kajabi_contact_id", kajabiId).maybeSingle(),
    service.schema("bronze").from("kajabi_customers").select("data, updated_at_kajabi").in("email", emails),
  ]);
  if (contactResult.error) throw contactResult.error;
  if (customersResult.error) throw customersResult.error;

  type CustomerRow = {
    data: {
      attributes?: {
        public_bio?: string | null;
        socials?: { instagram?: string | null; facebook?: string | null; twitter?: string | null } | null;
      };
    } | null;
    updated_at_kajabi: string;
  };
  const latestCustomer = ((customersResult.data ?? []) as CustomerRow[]).reduce<CustomerRow | null>(
    (latest, row) => (!latest || row.updated_at_kajabi > latest.updated_at_kajabi ? row : latest),
    null
  );
  const attrs = latestCustomer?.data?.attributes;

  return {
    instagramHandle: nonBlank(contactResult.data?.data?.attributes?.[INSTAGRAM_CUSTOM_FIELD_HANDLE]),
    socialsInstagram: nonBlank(attrs?.socials?.instagram),
    kajabiDetails: {
      bio: attrs?.public_bio || null,
      facebook_url: toSocialUrl(FACEBOOK_BASE_URL, attrs?.socials?.facebook),
      twitter_url: toSocialUrl(X_BASE_URL, attrs?.socials?.twitter),
    },
  };
}

async function loadMember(ctx: Ctx) {
  return ctx.service
    .from("members")
    .select("email, kajabi_id, bio, instagram_url, facebook_url, twitter_url")
    .eq("id", ctx.effectiveIdentity.memberId)
    .single();
}

/** Read through the caller's own session, so RLS scopes it to their row (or an admin's sudo target). */
async function loadOverride(ctx: Ctx) {
  return ctx.supabase
    .from("member_profile_overrides")
    .select("bio, facebook_url, twitter_url")
    .eq("member_id", ctx.effectiveIdentity.memberId)
    .maybeSingle();
}

function toDetails(fields: ProfileFields): ProfileDetails {
  return { bio: fields.bio, facebookUrl: fields.facebook_url, twitterUrl: fields.twitter_url };
}

export async function getProfileSettings(): Promise<ProfileSettings | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const memberId = ctx.effectiveIdentity.memberId;

  const [{ data: member, error }, { data: override, error: overrideError }] = await Promise.all([
    loadMember(ctx),
    loadOverride(ctx),
  ]);
  if (error || !member) return { error: error?.message ?? "Couldn't load your profile" };
  if (overrideError) {
    console.error("[profile] Failed to load profile overrides for member", memberId, overrideError);
    return { error: "Couldn't load your profile" };
  }

  let snapshot: KajabiProfileSnapshot = { instagramHandle: null, socialsInstagram: null, kajabiDetails: EMPTY_DETAILS };
  if (member.kajabi_id) {
    try {
      snapshot = await loadKajabiProfileSnapshot(ctx.service, member.kajabi_id, member.email);
    } catch (err) {
      console.error("[profile] Failed to load Kajabi Bronze snapshot for member", memberId, err);
      return { error: "Couldn't load your profile" };
    }
  }

  const effective = applyProfileOverride(snapshot.kajabiDetails, override);
  const expectedInstagram = resolveInstagramUrl(snapshot.instagramHandle, snapshot.socialsInstagram);
  const syncPending =
    (member.kajabi_id != null && expectedInstagram !== (member.instagram_url ?? null)) ||
    effective.bio !== (member.bio ?? null) ||
    effective.facebook_url !== (member.facebook_url ?? null) ||
    effective.twitter_url !== (member.twitter_url ?? null);

  return {
    memberId,
    kajabiLinked: member.kajabi_id != null,
    instagramHandle: snapshot.instagramHandle,
    instagramFallbackUrl: toSocialUrl(INSTAGRAM_BASE_URL, snapshot.socialsInstagram),
    details: toDetails(effective),
    syncPending,
  };
}

export type UpdateProfileResult = { success: true; syncPending: boolean; warning?: string } | { error: string };

function scheduleMemberReprocess(changedTable: "kajabi_contacts" | "member_profile_overrides", what: string) {
  after(async () => {
    try {
      const layer = changedTable === "kajabi_contacts" ? "bronze" : "local";
      const { processed } = await triggerReprocessing(changedTable, layer);
      const failed = processed.filter((r: { success: boolean }) => !r.success);
      if (failed.length > 0) console.error(`[profile] Member reprocessing after ${what} edit failed:`, failed);
    } catch (err) {
      console.error(`[profile] Member reprocessing after ${what} edit failed:`, err);
    }
  });
}

export interface ProfileDetailsInput {
  bio: string;
  facebook: string;
  x: string;
}

/**
 * Save bio / Facebook / X as member_profile_overrides (three states per field,
 * see lib/member-profile-overrides.ts). Per field, compared with what the
 * profile currently shows:
 *   - unchanged        -> stored state kept (a never-set field stays NULL and keeps following Kajabi)
 *   - blanked          -> '' (cleared: the profile shows nothing, no Kajabi fallback)
 *   - any other value  -> stored as the member's own value, even if it equals Kajabi's
 */
export async function updateProfileDetails(input: ProfileDetailsInput): Promise<UpdateProfileResult> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity, user } = ctx;

  const bio = parseBioInput(input.bio);
  if ("error" in bio) return bio;
  const facebook = parseFacebookInput(input.facebook);
  if ("error" in facebook) return { error: `Facebook: ${facebook.error}` };
  const x = parseXInput(input.x);
  if ("error" in x) return { error: `X: ${x.error}` };

  const [{ data: member, error: memberError }, { data: existing, error: overrideError }] = await Promise.all([
    loadMember(ctx),
    loadOverride(ctx),
  ]);
  if (memberError || !member) return { error: memberError?.message ?? "Couldn't load your profile" };
  if (overrideError) {
    console.error("[profile] Failed to load profile overrides for member", effectiveIdentity.memberId, overrideError);
    return { error: "Couldn't load your profile" };
  }

  let kajabiDetails = EMPTY_DETAILS;
  if (member.kajabi_id) {
    try {
      kajabiDetails = (await loadKajabiProfileSnapshot(ctx.service, member.kajabi_id, member.email)).kajabiDetails;
    } catch (err) {
      console.error("[profile] Failed to load Kajabi Bronze snapshot for member", effectiveIdentity.memberId, err);
      return { error: "Couldn't load your profile" };
    }
  }

  const current = {
    bio: existing?.bio ?? null,
    facebook_url: existing?.facebook_url ?? null,
    twitter_url: existing?.twitter_url ?? null,
  };
  const shown = applyProfileOverride(kajabiDetails, current);
  const next = {
    bio: nextOverrideValue(bio.bio, shown.bio, current.bio),
    facebook_url: nextOverrideValue(facebook.url, shown.facebook_url, current.facebook_url),
    twitter_url: nextOverrideValue(x.url, shown.twitter_url, current.twitter_url),
  };

  if (
    next.bio === current.bio &&
    next.facebook_url === current.facebook_url &&
    next.twitter_url === current.twitter_url
  ) {
    return { success: true, syncPending: false };
  }

  const { error } = await supabase
    .from("member_profile_overrides")
    .upsert({ member_id: effectiveIdentity.memberId, ...next, updated_by: user.id }, { onConflict: "member_id" });
  if (error) {
    console.error("[profile] Saving profile overrides failed for member", effectiveIdentity.memberId, error);
    return { error: "Couldn't save your profile — please try again." };
  }

  console.log(
    `[profile] Bio/social overrides updated for member ${effectiveIdentity.memberId}` +
      (effectiveIdentity.isSudo ? " (by an admin in sudo mode)" : "")
  );

  scheduleMemberReprocess("member_profile_overrides", "profile details");
  revalidatePath("/settings");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true, syncPending: true };
}

export async function updateInstagramHandle(input: string): Promise<UpdateProfileResult> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { service, effectiveIdentity } = ctx;

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

  let snapshot: KajabiProfileSnapshot;
  try {
    snapshot = await loadKajabiProfileSnapshot(service, member.kajabi_id, member.email);
  } catch (err) {
    console.error("[profile] Failed to load Kajabi Bronze snapshot for member", effectiveIdentity.memberId, err);
    return { error: "Couldn't load your profile" };
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
    return { error: `Couldn't save your Instagram (${detail}). Nothing was changed — please try again.` };
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
      // The members reconcile cron (vercel.json) runs a full Kajabi sync nightly.
      warning: "Saved. It may take until tomorrow to show on your profile.",
    };
  }

  scheduleMemberReprocess("kajabi_contacts", "Instagram");
  revalidatePath("/settings");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true, syncPending: true };
}
