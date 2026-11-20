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
  WRITER_PAGE_PATH,
  WRITER_PREVIEW_PATH,
  cleanBio,
  publishablePhotoUrl,
  suggestHandle,
  validateHandle,
  writerPagePath,
  writerPageUrl,
} from "@/lib/writer-profile";
import { withAction } from "@/lib/analytics/server";
import { WRITER_PAGES_NOT_AVAILABLE, WRITER_PAGE_NAME_NEEDED, memberHasWriterPages } from "@/lib/writer-pages-access";

/**
 * Settings > Profile > "Your page on the web" (docs/WRITER_PROFILES.md): the member's own public writer page. Everything
 * here is about the effective identity, so sudo shows and changes the member's page. The settings and the switch run on the
 * member's own client (row-level security, audited as them); the handle runs with the service role because it looks across
 * members (taken, held for someone) and the reserved words are ours to check first.
 */

/** One name the page can show: the display name (`aliasId` null), or a pen name the member allowed. */
export interface WriterPageNameChoice {
  aliasId: string | null;
  label: string;
}

export interface WriterPageSettings {
  /** The `writer_pages` flag is on for them. When it is not, the settings show nothing about the page and nothing can be switched on. */
  available: boolean;
  /** They have chosen a handle, so the page exists (still off until they switch it on). */
  hasPage: boolean;
  handle: string | null;
  isPublic: boolean;
  /** The pen name chosen, or null for the display name. */
  publicNameAliasId: string | null;
  /** The separate bio written for the page ("" when there is none: the page then uses their own bio, if its level is the globe). */
  publicBio: string;
  /** The page has a name they chose: a display name, or a pen name for the page. Without one the page would show the name on the account. */
  nameChosen: boolean;
  /** The display name first (when they have one), then each pen name they allowed. Never the name on the account. */
  nameChoices: WriterPageNameChoice[];
  /** A photo exists that may be put on a public page (a Gravatar picture never is). */
  photoAvailable: boolean;
  /** A handle to start from, made from their display name; "" when none fits. */
  suggestedHandle: string;
  /** The start of every address, to show before the handle ("hub.example.com/w/"). */
  addressPrefix: string;
  /** They have no display name, so the page would show the name on their account. */
  usingAccountName: boolean;
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
async function requireWriterPages(memberId: string): Promise<{ error: string } | null> {
  return (await memberHasWriterPages(getServiceRepos(), memberId)) ? null : { error: WRITER_PAGES_NOT_AVAILABLE };
}

export async function getWriterPageSettings(): Promise<WriterPageSettings | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const repos = createRepos(ctx.supabase);
  const [page, member, aliases, available] = await Promise.all([
    repos.writerProfiles.ofMember(ctx.memberId),
    repos.members.byId(ctx.memberId),
    repos.aliases.namesOf(ctx.memberId),
    memberHasWriterPages(getServiceRepos(), ctx.memberId),
  ]);
  // The name on the account is the legal name for many members: it is never offered as the page's name or used to suggest an address.
  const displayName = member?.displayName?.trim() ?? "";
  return {
    available,
    hasPage: page !== null,
    handle: page?.handle ?? null,
    isPublic: page?.isPublic ?? false,
    publicNameAliasId: page?.publicNameAliasId ?? null,
    publicBio: page?.bio ?? "",
    nameChosen: Boolean(member?.displayName?.trim()) || (page?.publicNameAliasId ?? null) !== null,
    nameChoices: [
      ...(displayName ? [{ aliasId: null, label: displayName }] : []),
      ...aliases.filter((a) => a.isPublic && a.active && a.source === "member" && a.alias !== displayName).map((a) => ({ aliasId: a.id, label: a.alias })),
    ],
    photoAvailable: publishablePhotoUrl(member?.photoUrl) !== null,
    suggestedHandle: suggestHandle(displayName),
    addressPrefix: `${new URL(APP_URL).host}${WRITER_PAGE_PATH}/`,
    usingAccountName: !member?.displayName?.trim(),
    pageUrl: page ? writerPageUrl(page.handle) : null,
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
  const closed = await requireWriterPages(ctx.memberId);
  if (closed) return closed;

  const now = new Date(clock.now());
  const outcome = await getServiceRepos().writerProfiles.setHandle(ctx.memberId, checked.handle, { reserveDays: WRITER_PROFILES.handleReservationDays, now });
  if (outcome === "taken" || outcome === "reserved") return { error: HANDLE_UNAVAILABLE_MESSAGES[outcome] };

  if (outcome === "created" || outcome === "changed") {
    // The handle is written with the service role, so the audit trigger can't say who did it; the member's own history can.
    await createRepos(ctx.supabase)
      .activities.record({
        memberId: ctx.memberId,
        type: outcome === "created" ? "writer_page_address_chosen" : "writer_page_address_changed",
        category: "profile",
        title: outcome === "created" ? "Chose the address of their public writer page" : "Changed the address of their public writer page",
        occurredAt: now.toISOString(),
        source: "writer_page",
        engagementValue: 0,
        actorKind: ctx.isSudo ? "staff" : "member",
        actorUserId: ctx.userId,
      })
      .catch((error) => console.error("claimWriterHandle: failed to record the activity", error));
  }

  revalidatePath("/settings", "layout");
  revalidatePath(writerPagePath(checked.handle));
  return { success: true, handle: checked.handle, changed: outcome === "changed" };
}

async function setWriterPageSwitchImpl(isPublic: boolean): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  // Turning it off is always allowed, so a page can be taken down whatever the flag says; turning it on needs the flag.
  if (isPublic) {
    const closed = await requireWriterPages(ctx.memberId);
    if (closed) return closed;
  }
  const repos = createRepos(ctx.supabase);
  if (isPublic) {
    // The page needs an address and a name chosen on purpose, so it never goes up under an address or a name nobody picked.
    const [page, member] = await Promise.all([repos.writerProfiles.ofMember(ctx.memberId), repos.members.byId(ctx.memberId)]);
    if (!page) return { error: "Choose the address for your page first." };
    if (!member?.displayName?.trim() && page.publicNameAliasId === null) return { error: WRITER_PAGE_NAME_NEEDED };
  }
  const updated = await repos.writerProfiles.update(ctx.memberId, { isPublic });
  if (!updated) return { error: "Choose the address for your page first." };
  revalidatePath("/settings", "layout");
  revalidatePath(writerPagePath(updated.handle));
  return { success: true };
}

async function saveWriterPageDetailsImpl(input: { publicNameAliasId: string | null; bio: string }): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const bio = cleanBio(input.bio);
  if (!bio.ok) return { error: bio.message };
  const closed = await requireWriterPages(ctx.memberId);
  if (closed) return closed;

  const repos = createRepos(ctx.supabase);
  try {
    const updated = await repos.writerProfiles.update(ctx.memberId, { publicNameAliasId: input.publicNameAliasId, bio: bio.bio });
    if (!updated) return { error: "Choose the address for your page first." };
    revalidatePath(writerPagePath(updated.handle));
  } catch (error) {
    if (error instanceof PublicNameNotAllowedError) return { error: error.message };
    throw error;
  }
  revalidatePath("/settings", "layout");
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function claimWriterHandle(...args: Parameters<typeof claimWriterHandleImpl>): ReturnType<typeof claimWriterHandleImpl> {
  return withAction("writer_page_handle_set", () => claimWriterHandleImpl(...args));
}

export async function setWriterPageSwitch(...args: Parameters<typeof setWriterPageSwitchImpl>): ReturnType<typeof setWriterPageSwitchImpl> {
  return withAction("writer_page_switched", () => setWriterPageSwitchImpl(...args));
}

export async function saveWriterPageDetails(...args: Parameters<typeof saveWriterPageDetailsImpl>): ReturnType<typeof saveWriterPageDetailsImpl> {
  return withAction("writer_page_settings_saved", () => saveWriterPageDetailsImpl(...args));
}
