import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEMBER_PHOTO, WRITER_PROFILES } from "@/lib/config";
import type { MemberRepository } from "@/lib/data/members";
import type { MemberStatusRepository } from "@/lib/data/member-status-overrides";
import { gravatarUrl } from "@/lib/member-avatar";
import { MEMBER_PHOTO_BUCKET } from "@/lib/member-photo";
import { inspectImage } from "@/lib/media/inspect";
import { fetchImage, type FetchImageResult } from "@/lib/net/safe-fetch";
import { encodePhoto, PHOTO_CONTENT_TYPE } from "@/lib/members/adopt-photos";

/**
 * A member's own profile photo (docs/product/WRITER_PROFILES.md, "The photo"): uploaded by them, or a copy of their Gravatar
 * picture made once when they open the photo to the web. Either way it is a small WebP in the `member-photos` bucket, at
 * `<member id>/<hash>.webp` (a Gravatar copy at `<member id>/gravatar-<hash>.webp`), remembered as
 * `member_profile_overrides.photo_path` so member processing keeps it, and pointed at from `members.photo_url`.
 *
 * Only server code writes to the bucket (it has no storage policy for members), after checking the bytes: the type is decided
 * by sniffing, never by the file name or the browser's type, and the picture is re-encoded, which drops EXIF (including
 * location) and any other metadata.
 */

export interface MemberPhotoStore {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  publicUrl(path: string): string;
}

export interface MemberPhotoDeps {
  members: Pick<MemberRepository, "setPhotoUrl">;
  memberStatus: Pick<MemberStatusRepository, "profileOverrideOf" | "saveProfileOverride">;
  store: MemberPhotoStore;
}

/** The store over the (service-role) storage client. */
export function memberPhotoStore(supabase: SupabaseClient): MemberPhotoStore {
  const bucket = () => supabase.storage.from(MEMBER_PHOTO_BUCKET);
  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(error.message);
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw new Error(error.message);
    },
    publicUrl: (path) => bucket().getPublicUrl(path).data.publicUrl,
  };
}

/** What can be uploaded. */
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** The most a file may be, in words for a member ("5 MB"). */
export const MAX_UPLOAD_LABEL = `${Math.floor(MEMBER_PHOTO.maxUploadBytes / (1024 * 1024))} MB`;

export type PreparedPhoto = { ok: true; encoded: Buffer } | { ok: false; error: string };

/** The bytes of an upload, checked and re-encoded: the size, then what the bytes really are, then a small WebP without metadata. */
export async function prepareUpload(bytes: Buffer): Promise<PreparedPhoto> {
  if (bytes.byteLength === 0) return { ok: false, error: "That file is empty." };
  if (bytes.byteLength > MEMBER_PHOTO.maxUploadBytes) return { ok: false, error: `Use a photo of ${MAX_UPLOAD_LABEL} or less.` };
  const inspected = await inspectImage(bytes);
  if (!inspected.ok) return { ok: false, error: inspected.heic ? "Use a JPEG, PNG or WebP photo (a HEIC photo needs saving as a JPEG first)." : "That doesn't look like a photo we can use. Use a JPEG, PNG or WebP photo." };
  if (!(UPLOAD_TYPES as readonly string[]).includes(inspected.mime)) return { ok: false, error: "Use a JPEG, PNG or WebP photo." };
  const encoded = await encodePhoto(bytes);
  return encoded ? { ok: true, encoded } : { ok: false, error: "We couldn't read that photo. Try another one." };
}

/** Where a photo is kept: the member's own folder, named by what is in it, so an address never changes under a cached picture. */
export function photoPathFor(memberId: string, encoded: Buffer, origin: "upload" | "gravatar"): string {
  const hash = createHash("sha256").update(encoded).digest("hex").slice(0, 32);
  return `${memberId}/${origin === "gravatar" ? "gravatar-" : ""}${hash}.webp`;
}

/** Whether an address is a Gravatar one (whose path carries a hash of the member's email). */
export function isGravatarAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  try {
    const host = new URL(address).hostname.toLowerCase();
    return WRITER_PROFILES.unpublishablePhotoHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

/** Where the member's photo comes from, for the words next to it. */
export type PhotoSource = "uploaded" | "gravatar_copy" | "gravatar" | "slack" | "kajabi" | "other" | "none";

export function photoSource(photoUrl: string | null | undefined, photoPath: string | null | undefined): PhotoSource {
  if (photoPath) return photoPath.split("/")[1]?.startsWith("gravatar-") ? "gravatar_copy" : "uploaded";
  if (!photoUrl) return "none";
  if (isGravatarAddress(photoUrl)) return "gravatar";
  if (/slack/i.test(photoUrl)) return "slack";
  if (/kajabi/i.test(photoUrl)) return "kajabi";
  return "other";
}

/**
 * Makes this the member's photo: stores it, remembers it, points `members.photo_url` at it, and deletes the file it replaces
 * (best effort: a leftover file is harmless, a missing one is not). The override is written before the address, so if the run
 * stops in between, processing still keeps the new photo.
 */
export async function replaceMemberPhoto(deps: MemberPhotoDeps, memberId: string, encoded: Buffer, origin: "upload" | "gravatar", updatedBy: string | null): Promise<string> {
  const previous = (await deps.memberStatus.profileOverrideOf(memberId))?.photo_path ?? null;
  const path = photoPathFor(memberId, encoded, origin);
  await deps.store.upload(path, encoded, PHOTO_CONTENT_TYPE);
  await deps.memberStatus.saveProfileOverride(memberId, { photo_path: path }, updatedBy);
  const url = deps.store.publicUrl(path);
  await deps.members.setPhotoUrl(memberId, url);
  if (previous && previous !== path) await deps.store.remove(previous).catch((error) => console.error("[photo] Couldn't delete the replaced photo for member", memberId, error));
  return url;
}

/**
 * Takes the member's own photo away: forgets it, deletes the file, and goes back to the picture they would have without one
 * (their Gravatar, or initials; processing finds a Kajabi or Slack photo again at its next run). False when they had none.
 */
export async function removeMemberPhoto(deps: MemberPhotoDeps, memberId: string, email: string, updatedBy: string | null): Promise<boolean> {
  const previous = (await deps.memberStatus.profileOverrideOf(memberId))?.photo_path ?? null;
  if (!previous) return false;
  await deps.memberStatus.saveProfileOverride(memberId, { photo_path: null }, updatedBy);
  await deps.members.setPhotoUrl(memberId, gravatarUrl(email));
  await deps.store.remove(previous).catch((error) => console.error("[photo] Couldn't delete the removed photo for member", memberId, error));
  return true;
}

export type GravatarCopy = { ok: true } | { ok: false; reason: "none" | "failed" };

/**
 * Copies the member's Gravatar picture into our storage, once, so a public profile can show it without the address that
 * carries a hash of their email. The address is built here from the member's own email on the one configured Gravatar host
 * (never from anything typed), with `d=404`, so a member with no Gravatar gets a 404: "none", and nothing is stored. The
 * fetch is the pinned, size-capped, time-limited one (`fetchImage`), and the bytes go through the same re-encoding as an upload.
 */
export async function copyGravatarPhoto(
  deps: MemberPhotoDeps,
  memberId: string,
  email: string,
  updatedBy: string | null,
  fetchOne: (url: string) => Promise<FetchImageResult> = fetchImage,
): Promise<GravatarCopy> {
  const address = gravatarUrl(email, 512);
  const parsed = new URL(address);
  if (parsed.protocol !== "https:" || parsed.hostname !== MEMBER_PHOTO.gravatarHost || !parsed.pathname.startsWith("/avatar/")) return { ok: false, reason: "failed" };
  const got = await fetchOne(address);
  if (!got.ok) return { ok: false, reason: got.reason === "bad_status" && got.status === 404 ? "none" : "failed" };
  const encoded = await encodePhoto(got.bytes);
  if (!encoded) return { ok: false, reason: "failed" };
  try {
    await replaceMemberPhoto(deps, memberId, encoded, "gravatar", updatedBy);
  } catch (error) {
    console.error("[photo] Couldn't store the Gravatar copy for member", memberId, error);
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}
