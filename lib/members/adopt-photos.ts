import { createHash } from "node:crypto";
import sharp from "sharp";
import type { MemberRepository } from "@/lib/data/members";
import type { MemberStatusRepository } from "@/lib/data/member-status-overrides";
import { chunk } from "@/lib/supabase/paginate";
import { fetchImage, type FetchImageResult } from "@/lib/net/safe-fetch";
import { MAX_PIXELS } from "@/lib/media/inspect";

/**
 * Copies member profile photos that live on Kajabi's CDN into our own storage (the CDN goes away with Kajabi).
 *
 * A photo address in `members.photo_url` is rebuilt by member processing from Kajabi, Slack and Gravatar on every run,
 * so a copy is remembered as `member_profile_overrides.photo_path` (lib/member-photo.ts), which processing prefers,
 * and `members.photo_url` is pointed at it straight away. Safe to run again: a member whose photo is no longer on a
 * Kajabi host (their own, or already moved) is not looked at, one whose copy exists is only repaired, and a photo that
 * could not be fetched is reported and tried again next time.
 */

/** Longest side of a stored photo: avatars are drawn small; 512 covers a retina profile page. */
export const PHOTO_MAX_SIDE = 512;
export const PHOTO_CONTENT_TYPE = "image/webp";
const CONCURRENCY = 5;

export type FailureClass = "blocked" | "dead_link" | "too_large" | "timeout" | "network" | "not_image" | "unreadable_image" | "storage" | "database";

export interface PhotoStore {
  /** Writes the file (replacing one at the same path: the path holds a hash of the bytes). */
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  publicUrl(path: string): string;
}

export interface AdoptPhotosDeps {
  members: Pick<MemberRepository, "withPhotos" | "setPhotoUrlIf">;
  memberStatus: Pick<MemberStatusRepository, "profileOverrideOf" | "saveProfileOverride">;
  store: PhotoStore;
  /** Host names (no scheme) whose photos are copied. */
  hosts: readonly string[];
  /** Tests pass a fake; the script uses the pinned https fetch. */
  fetchImage?: (url: string) => Promise<FetchImageResult>;
  onProgress?: (done: number, total: number) => void;
}

export interface AdoptPhotosReport {
  /** True when nothing was written. */
  dryRun: boolean;
  /** Members whose photo is on one of the hosts. */
  considered: number;
  /** Copied (or, in a dry run, would be). */
  adopted: number;
  /** Already had a copy; counted `repaired` when their photo address still pointed at Kajabi and was fixed. */
  alreadyAdopted: number;
  repaired: number;
  /** Their photo changed while the run was going, so their own choice was left alone. */
  changedMeanwhile: number;
  /** Counts by why a photo could not be copied; those members stay as they were. */
  failed: Partial<Record<FailureClass, number>>;
  failedTotal: number;
}

/** Whether a photo address is on one of the hosts (https only, exact host). */
export function isOnHosts(address: string, hosts: readonly string[]): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && hosts.some((h) => h.toLowerCase() === url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function fetchFailure(result: Extract<FetchImageResult, { ok: false }>): FailureClass {
  switch (result.reason) {
    case "bad_status":
    case "invalid_url":
    case "too_many_redirects":
      return "dead_link";
    case "blocked":
    case "too_large":
    case "timeout":
    case "network":
    case "not_image":
      return result.reason;
  }
}

/** Re-encodes to a small WebP (auto-rotated, metadata dropped, first frame of an animation). Null when it won't decode. */
export async function encodePhoto(bytes: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(bytes, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function adoptMemberPhotos(deps: AdoptPhotosDeps, { apply }: { apply: boolean }): Promise<AdoptPhotosReport> {
  const fetchOne = deps.fetchImage ?? fetchImage;
  const report: AdoptPhotosReport = { dryRun: !apply, considered: 0, adopted: 0, alreadyAdopted: 0, repaired: 0, changedMeanwhile: 0, failed: {}, failedTotal: 0 };
  const fail = (reason: FailureClass) => {
    report.failed[reason] = (report.failed[reason] ?? 0) + 1;
    report.failedTotal++;
  };

  const todo = (await deps.members.withPhotos()).filter((m) => isOnHosts(m.photoUrl, deps.hosts));
  report.considered = todo.length;
  let done = 0;

  const adoptOne = async (member: { id: string; photoUrl: string }) => {
    const existing = await deps.memberStatus.profileOverrideOf(member.id);
    if (existing?.photo_path) {
      // Copied before; processing will put our address back, so only the row's own address can still be stale.
      report.alreadyAdopted++;
      if (apply && (await deps.members.setPhotoUrlIf(member.id, member.photoUrl, deps.store.publicUrl(existing.photo_path)))) report.repaired++;
      return;
    }

    const got = await fetchOne(member.photoUrl);
    if (!got.ok) return fail(fetchFailure(got));
    const encoded = await encodePhoto(got.bytes);
    if (!encoded) return fail("unreadable_image");
    if (!apply) {
      report.adopted++;
      return;
    }

    const path = `${member.id}/${createHash("sha256").update(encoded).digest("hex").slice(0, 32)}.webp`;
    try {
      await deps.store.upload(path, encoded, PHOTO_CONTENT_TYPE);
    } catch {
      return fail("storage");
    }
    try {
      // The override first: if the row is then moved and the run stops, reprocessing keeps our copy. If the row
      // can't be moved because the member changed their photo meanwhile, the override is taken back.
      await deps.memberStatus.saveProfileOverride(member.id, { photo_path: path }, null);
      if (await deps.members.setPhotoUrlIf(member.id, member.photoUrl, deps.store.publicUrl(path))) report.adopted++;
      else {
        await deps.memberStatus.saveProfileOverride(member.id, { photo_path: null }, null);
        report.changedMeanwhile++;
      }
    } catch {
      fail("database");
    }
  };

  for (const group of chunk(todo, CONCURRENCY)) {
    await Promise.all(
      group.map(async (member) => {
        try {
          await adoptOne(member);
        } catch {
          fail("database");
        }
        deps.onProgress?.(++done, todo.length);
      }),
    );
  }
  return report;
}
