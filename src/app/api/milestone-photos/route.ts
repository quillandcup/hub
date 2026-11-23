import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getServiceRepos } from "@/lib/data/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { clock } from "@/lib/clock";
import { MILESTONE_PHOTO } from "@/lib/config";
import { parsePhotoAlt, tokenOfPath, type PhotoTarget } from "@/lib/milestone-photos";
import { discardPhoto, milestonePhotoStore, prepareMilestonePhoto, storeMilestonePhoto } from "@/lib/members/milestone-photo";
import { revalidateMilestoneSurfaces } from "@/lib/milestone-revalidate";
import { withAction } from "@/lib/analytics/server";
import { responseOutcome } from "@/lib/analytics/outcome";

/**
 * The member's own photo on a milestone (docs/product/FINISHERS.md, "Photos"): POST a file as the form field `photo`, with the
 * `target` ("milestone" for THE END or publish-ready, "book" for the Published step) and its `id`, and optionally `alt` (what the
 * photo shows), to add or replace it; DELETE with the same `target` and `id` in the query to take it away. It is always the
 * signed-in member's own milestone or book, through the effective identity, and staff viewing as a member can look but not
 * change anything. The bytes are checked and re-encoded here (`prepareMilestonePhoto`); only the server writes to the private
 * bucket, always in the member's own folder, and a member has no database grant on the photo columns either.
 */
async function caller() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { response: NextResponse.json({ error: "No member record" }, { status: 403 }) };
  if (identity.isSudo) return { response: NextResponse.json({ error: "Staff can look at a member's photos, but not change them." }, { status: 403 }) };
  return { memberId: identity.memberId, repos: getServiceRepos(), store: milestonePhotoStore(createServiceRoleClient()) };
}

function targetOf(value: unknown): PhotoTarget | null {
  return value === "milestone" || value === "book" ? value : null;
}

const NOT_FOUND = () => NextResponse.json({ error: "We couldn't find that. It may have been taken back." }, { status: 404 });

async function handlePost(request: NextRequest) {
  const who = await caller();
  if ("response" in who) return who.response;

  // A declared size over the limit is refused before the body is read.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MILESTONE_PHOTO.maxUploadBytes + 64 * 1024) {
    return NextResponse.json({ error: "That photo is too large." }, { status: 413 });
  }
  const formData = await request.formData().catch(() => undefined);
  const file = formData?.get("photo");
  const target = targetOf(formData?.get("target"));
  const id = formData?.get("id");
  if (!target || typeof id !== "string" || id === "") return NextResponse.json({ error: "Tell us which photo this is for." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo to upload." }, { status: 400 });
  if (file.size > MILESTONE_PHOTO.maxUploadBytes) return NextResponse.json({ error: "That photo is too large." }, { status: 413 });
  const alt = parsePhotoAlt(formData?.get("alt") ?? null);
  if ("error" in alt) return NextResponse.json({ error: alt.error }, { status: 400 });

  // It has to be the member's own, live, confirmed milestone (or live book) before anything is stored.
  const mine =
    target === "milestone"
      ? (await who.repos.milestones.ofMember(who.memberId)).some((m) => m.id === id && m.status === "confirmed")
      : (await who.repos.books.mine(who.memberId)).some((b) => b.id === id);
  if (!mine) return NOT_FOUND();

  const prepared = await prepareMilestonePhoto(Buffer.from(await file.arrayBuffer()));
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });

  let path: string | null = null;
  try {
    path = await storeMilestonePhoto(who.store, who.memberId, prepared.encoded);
    const now = new Date(clock.now());
    const saved =
      target === "milestone"
        ? await who.repos.milestones.setPhoto(id, who.memberId, path, alt.alt, now)
        : await who.repos.milestones.setBookPhoto(id, who.memberId, path, alt.alt, now);
    if (!saved) {
      // Taken back between the check and the write: the file has nothing pointing at it.
      await discardPhoto(who.store, path);
      return NOT_FOUND();
    }
    await discardPhoto(who.store, saved.previousPath);
    await revalidateMilestoneSurfaces(who.repos, who.memberId);
    return NextResponse.json({ token: tokenOfPath(path), alt: alt.alt });
  } catch (error) {
    console.error("[milestone-photo] Saving a photo failed for member", who.memberId, error instanceof Error ? error.message : String(error));
    await discardPhoto(who.store, path);
    return NextResponse.json({ error: "Couldn't save your photo. Please try again." }, { status: 500 });
  }
}

async function handleDelete(request: NextRequest) {
  const who = await caller();
  if ("response" in who) return who.response;
  const target = targetOf(request.nextUrl.searchParams.get("target"));
  const id = request.nextUrl.searchParams.get("id");
  if (!target || !id) return NextResponse.json({ error: "Tell us which photo this is for." }, { status: 400 });
  try {
    const removed =
      target === "milestone"
        ? await who.repos.milestones.removePhoto(id, who.memberId, new Date(clock.now()))
        : await who.repos.milestones.removeBookPhoto(id, who.memberId);
    if (!removed) return NOT_FOUND();
    await discardPhoto(who.store, removed.previousPath);
    await revalidateMilestoneSurfaces(who.repos, who.memberId);
    return NextResponse.json({ removed: removed.previousPath !== null });
  } catch (error) {
    console.error("[milestone-photo] Removing a photo failed for member", who.memberId, error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Couldn't remove your photo. Please try again." }, { status: 500 });
  }
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
export async function POST(...args: Parameters<typeof handlePost>): Promise<Response> {
  return withAction("milestone_photo_set", async () => (await handlePost(...args)) as Response, responseOutcome);
}

export async function DELETE(...args: Parameters<typeof handleDelete>): Promise<Response> {
  return withAction("milestone_photo_removed", async () => (await handleDelete(...args)) as Response, responseOutcome);
}
