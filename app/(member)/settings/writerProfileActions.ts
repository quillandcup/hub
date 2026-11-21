"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createRepos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { PublicNameNotAllowedError } from "@/lib/data/writer-profiles";
import { clock } from "@/lib/clock";
import { APP_URL, WRITER_PROFILES } from "@/lib/config";
import {
  HANDLE_UNAVAILABLE_MESSAGES,
  WRITER_PROFILE_PATH,
  WRITER_PREVIEW_PATH,
  cleanBio,
  publishablePhotoUrl,
  suggestHandle,
  validateHandle,
  writerProfilePath,
  writerProfileUrl,
} from "@/lib/writer-profile";
import { withAction } from "@/lib/analytics/server";
import { addNameAlias, setNameAliasPublic } from "./identityActions";
import { WRITER_PROFILES_NOT_AVAILABLE, WRITER_PROFILE_NAME_NEEDED, memberHasWriterProfiles } from "@/lib/writer-profiles-access";

/**
 * Settings > Profile > "Your page on the web" (docs/product/WRITER_PROFILES.md): the member's own public writer profile. Everything
 * here is about the effective identity, so sudo shows and changes the member's page. The settings and the switch run on the
 * member's own client (row-level security, audited as them); the handle runs with the service role because it looks across
 * members (taken, held for someone) and the reserved words are ours to check first.
 */

/**
 * One name the profile can show: the display name, a pen name the member marked for their profile (`aliasId` is its id), or
 * the name on their account, offered as a choice of its own and never picked for them.
 */
export interface WriterProfileNameChoice {
  kind: "display" | "alias" | "account";
  aliasId: string | null;
  /** The name itself, as it would be shown. */
  label: string;
}

export interface MyWriterProfile {
  /** The `writer_profiles` flag is on for them. When it is not, the settings show nothing about the page and nothing can be switched on. */
  available: boolean;
  /** They have chosen a handle, so the page exists (still off until they switch it on). */
  hasPage: boolean;
  handle: string | null;
  isPublic: boolean;
  /** The pen name chosen, or null (the display name, or the account name when `useAccountName`). */
  publicNameAliasId: string | null;
  /** They picked the name on their account as the name shown. */
  useAccountName: boolean;
  /** The separate bio written for the page ("" when there is none: the page then uses their own bio, if its level is the globe). */
  publicBio: string;
  /** The profile has a name chosen on purpose: a display name, a pen name, or the account name picked as such. */
  nameChosen: boolean;
  /** The display name first (when they have one), then each pen name they marked public, then the name on the account. */
  nameChoices: WriterProfileNameChoice[];
  /** A photo exists that may be put on a public page (a Gravatar picture never is). */
  photoAvailable: boolean;
  /** A handle to start from, made from their display name; "" when none fits. */
  suggestedHandle: string;
  /** The start of every address, to show before the handle ("hub.example.com/w/"). */
  addressPrefix: string;
  /** The page's address, when it exists. */
  pageUrl: string | null;
  /** Where the page can be seen by its owner whether or not it is on. */
  previewPath: string;
}

type Context = { error: string } | { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; memberId: string; isSudo: boolean };

async function requireIdentity(): Promise<Context> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  return { supabase: await createClient(), userId: user.id, memberId: identity.memberId, isSudo: identity.isSudo };
}

/** The flag is decided for the effective member, so sudo asks about the member whose page it is. */
async function requireWriterProfiles(memberId: string): Promise<{ error: string } | null> {
  return (await memberHasWriterProfiles(getServiceRepos(), memberId)) ? null : { error: WRITER_PROFILES_NOT_AVAILABLE };
}

export async function getMyWriterProfile(): Promise<MyWriterProfile | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const repos = createRepos(ctx.supabase);
  const [page, member, aliases, available] = await Promise.all([
    repos.writerProfiles.ofMember(ctx.memberId),
    repos.members.byId(ctx.memberId),
    repos.aliases.namesOf(ctx.memberId),
    memberHasWriterProfiles(getServiceRepos(), ctx.memberId),
  ]);
  // The name on the account is the legal name for many members: it is offered as a choice of its own, labeled as such, and is
  // never picked for them or used to suggest an address.
  const displayName = member?.displayName?.trim() ?? "";
  const accountName = member?.name?.trim() ?? "";
  const penNames = aliases.filter((a) => a.isPublic && a.active && a.source === "member" && a.alias !== displayName);
  const useAccountName = page?.useAccountName ?? false;
  return {
    available,
    hasPage: page !== null,
    handle: page?.handle ?? null,
    isPublic: page?.isPublic ?? false,
    publicNameAliasId: page?.publicNameAliasId ?? null,
    useAccountName,
    publicBio: page?.bio ?? "",
    nameChosen: displayName !== "" || (page?.publicNameAliasId ?? null) !== null || useAccountName,
    nameChoices: [
      ...(displayName ? [{ kind: "display" as const, aliasId: null, label: displayName }] : []),
      ...penNames.map((a) => ({ kind: "alias" as const, aliasId: a.id, label: a.alias })),
      ...(accountName && accountName !== displayName && !penNames.some((a) => a.alias === accountName) ? [{ kind: "account" as const, aliasId: null, label: accountName }] : []),
    ],
    photoAvailable: publishablePhotoUrl(member?.photoUrl) !== null,
    suggestedHandle: suggestHandle(displayName),
    addressPrefix: `${new URL(APP_URL).host}${WRITER_PROFILE_PATH}/`,
    pageUrl: page ? writerProfileUrl(page.handle) : null,
    previewPath: WRITER_PREVIEW_PATH,
  };
}

export type HandleStatus = { status: "available" | "yours" } | { status: "unavailable" | "invalid"; message: string };

/** Whether this handle can be had, for the live check as they type. A read: nothing is saved. */
export async function loadHandleStatus(input: string): Promise<HandleStatus | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const checked = validateHandle(input);
  if (!checked.ok) return { status: "invalid", message: checked.message };
  const availability = await getServiceRepos().writerProfiles.handleAvailability(ctx.memberId, checked.handle, new Date(clock.now()));
  if (availability === "available" || availability === "yours") return { status: availability };
  return { status: "unavailable", message: HANDLE_UNAVAILABLE_MESSAGES[availability] };
}

async function claimWriterHandleImpl(input: string): Promise<{ success: true; handle: string; changed: boolean } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const checked = validateHandle(input);
  if (!checked.ok) return { error: checked.message };
  const closed = await requireWriterProfiles(ctx.memberId);
  if (closed) return closed;

  const now = new Date(clock.now());
  const outcome = await getServiceRepos().writerProfiles.setHandle(ctx.memberId, checked.handle, { reserveDays: WRITER_PROFILES.handleReservationDays, now });
  if (outcome === "taken" || outcome === "reserved") return { error: HANDLE_UNAVAILABLE_MESSAGES[outcome] };

  if (outcome === "created" || outcome === "changed") {
    // The handle is written with the service role, so the audit trigger can't say who did it; the member's own history can.
    await createRepos(ctx.supabase)
      .activities.record({
        memberId: ctx.memberId,
        type: outcome === "created" ? "writer_profile_address_chosen" : "writer_profile_address_changed",
        category: "profile",
        title: outcome === "created" ? "Chose the address of their public writer profile" : "Changed the address of their public writer profile",
        occurredAt: now.toISOString(),
        source: "writer_profile",
        engagementValue: 0,
        actorKind: ctx.isSudo ? "staff" : "member",
        actorUserId: ctx.userId,
      })
      .catch((error) => console.error("claimWriterHandle: failed to record the activity", error));
  }

  revalidatePath("/settings", "layout");
  revalidatePath(writerProfilePath(checked.handle));
  return { success: true, handle: checked.handle, changed: outcome === "changed" };
}

async function setWriterProfileSwitchImpl(isPublic: boolean): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  // Turning it off is always allowed, so a page can be taken down whatever the flag says; turning it on needs the flag.
  if (isPublic) {
    const closed = await requireWriterProfiles(ctx.memberId);
    if (closed) return closed;
  }
  const repos = createRepos(ctx.supabase);
  if (isPublic) {
    // The page needs an address and a name chosen on purpose, so it never goes up under an address or a name nobody picked.
    const [page, member] = await Promise.all([repos.writerProfiles.ofMember(ctx.memberId), repos.members.byId(ctx.memberId)]);
    if (!page) return { error: "Choose the address for your profile first." };
    if (!member?.displayName?.trim() && page.publicNameAliasId === null && !page.useAccountName) return { error: WRITER_PROFILE_NAME_NEEDED };
  }
  const updated = await repos.writerProfiles.update(ctx.memberId, { isPublic });
  if (!updated) return { error: "Choose the address for your profile first." };
  revalidatePath("/settings", "layout");
  revalidatePath(writerProfilePath(updated.handle));
  return { success: true };
}

async function saveWriterProfileDetailsImpl(input: { publicNameAliasId: string | null; useAccountName?: boolean; bio: string }): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const bio = cleanBio(input.bio);
  if (!bio.ok) return { error: bio.message };
  const closed = await requireWriterProfiles(ctx.memberId);
  if (closed) return closed;

  const repos = createRepos(ctx.supabase);
  try {
    const updated = await repos.writerProfiles.update(ctx.memberId, { publicNameAliasId: input.publicNameAliasId, useAccountName: input.useAccountName, bio: bio.bio });
    if (!updated) return { error: "Choose the address for your profile first." };
    revalidatePath(writerProfilePath(updated.handle));
  } catch (error) {
    if (error instanceof PublicNameNotAllowedError) return { error: error.message };
    throw error;
  }
  revalidatePath("/settings", "layout");
  return { success: true };
}

/**
 * "Add a pen name" beside the name shown, so nobody has to leave the screen: the same checks as adding a name under Identity
 * (length, a name someone else has), then the name is marked for the profile. Choosing it as the name shown is a separate save.
 */
async function addProfilePenNameImpl(alias: string): Promise<{ success: true; aliasId: string } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const closed = await requireWriterProfiles(ctx.memberId);
  if (closed) return closed;

  const trimmed = alias.trim();
  const added = await addNameAlias(trimmed);
  if ("error" in added) return added;
  const row = await createRepos(ctx.supabase).aliases.findName(ctx.memberId, trimmed);
  if (!row) return { error: "Couldn't add that name." };
  const marked = await setNameAliasPublic(row.id, true);
  if ("error" in marked) return marked;
  return { success: true, aliasId: row.id };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function addProfilePenName(...args: Parameters<typeof addProfilePenNameImpl>): ReturnType<typeof addProfilePenNameImpl> {
  return withAction("writer_profile_pen_name_added", () => addProfilePenNameImpl(...args));
}

export async function claimWriterHandle(...args: Parameters<typeof claimWriterHandleImpl>): ReturnType<typeof claimWriterHandleImpl> {
  return withAction("writer_profile_handle_set", () => claimWriterHandleImpl(...args));
}

export async function setWriterProfileSwitch(...args: Parameters<typeof setWriterProfileSwitchImpl>): ReturnType<typeof setWriterProfileSwitchImpl> {
  return withAction("writer_profile_switched", () => setWriterProfileSwitchImpl(...args));
}

export async function saveWriterProfileDetails(...args: Parameters<typeof saveWriterProfileDetailsImpl>): ReturnType<typeof saveWriterProfileDetailsImpl> {
  return withAction("writer_profile_settings_saved", () => saveWriterProfileDetailsImpl(...args));
}
