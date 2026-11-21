import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getServiceRepos } from "@/lib/data/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { MEMBER_PHOTO } from "@/lib/config";
import { memberPhotoStore, prepareUpload, removeMemberPhoto, replaceMemberPhoto, type MemberPhotoDeps } from "@/lib/members/photo";
import { withAction } from "@/lib/analytics/server";
import { responseOutcome } from "@/lib/analytics/outcome";

/**
 * The member's own profile photo (Settings > Profile, docs/product/WRITER_PROFILES.md, "The photo"): POST a file as the form
 * field `photo` to set it, DELETE to take it away. It is always the signed-in member's own photo, through the effective
 * identity, and staff acting as a member can look but not change it. The bytes are checked and re-encoded on the server
 * (`prepareUpload`); only the server writes to the bucket, always in the member's own folder.
 */
async function caller() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { response: NextResponse.json({ error: "No member record" }, { status: 403 }) };
  if (identity.isSudo) return { response: NextResponse.json({ error: "Staff can look at a member's photo, but not change it." }, { status: 403 }) };
  const repos = getServiceRepos();
  const deps: MemberPhotoDeps = { members: repos.members, memberStatus: repos.memberStatus, store: memberPhotoStore(createServiceRoleClient()) };
  return { user, memberId: identity.memberId, repos, deps };
}

function refresh(memberId: string) {
  revalidatePath("/settings", "layout");
  revalidatePath("/members");
  revalidatePath(`/members/${memberId}`);
}

async function handlePost(request: NextRequest) {
  const who = await caller();
  if ("response" in who) return who.response;

  // A declared size over the limit is refused before the body is read.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MEMBER_PHOTO.maxUploadBytes + 64 * 1024) {
    return NextResponse.json({ error: "That photo is too large." }, { status: 413 });
  }
  const formData = await request.formData().catch(() => undefined);
  const file = formData?.get("photo");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo to upload." }, { status: 400 });
  if (file.size > MEMBER_PHOTO.maxUploadBytes) return NextResponse.json({ error: "That photo is too large." }, { status: 413 });

  const prepared = await prepareUpload(Buffer.from(await file.arrayBuffer()));
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });

  try {
    const url = await replaceMemberPhoto(who.deps, who.memberId, prepared.encoded, "upload", who.user.id);
    refresh(who.memberId);
    return NextResponse.json({ url });
  } catch (error) {
    console.error("[photo] Saving a member's photo failed for member", who.memberId, error);
    return NextResponse.json({ error: "Couldn't save your photo. Please try again." }, { status: 500 });
  }
}

async function handleDelete(_request: NextRequest) {
  const who = await caller();
  if ("response" in who) return who.response;
  try {
    const member = await who.repos.members.byId(who.memberId);
    if (!member) return NextResponse.json({ error: "No member record" }, { status: 403 });
    const removed = await removeMemberPhoto(who.deps, who.memberId, member.email, who.user.id);
    refresh(who.memberId);
    return NextResponse.json({ removed });
  } catch (error) {
    console.error("[photo] Removing a member's photo failed for member", who.memberId, error);
    return NextResponse.json({ error: "Couldn't remove your photo. Please try again." }, { status: 500 });
  }
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
export async function POST(...args: Parameters<typeof handlePost>): Promise<Response> {
  return withAction("profile_photo_uploaded", async () => (await handlePost(...args)) as Response, responseOutcome);
}

export async function DELETE(...args: Parameters<typeof handleDelete>): Promise<Response> {
  return withAction("profile_photo_removed", async () => (await handleDelete(...args)) as Response, responseOutcome);
}
