import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getServiceRepos } from "@/lib/data/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { memberHasWriterProfiles } from "@/lib/writer-profiles-access";
import { ANONYMOUS_VIEWER, decidePhotoAccess, isPhotoToken, photoCacheControl, type PhotoViewer } from "@/lib/milestone-photos";
import { milestonePhotoStore } from "@/lib/members/milestone-photo";

/**
 * A photo on a milestone, handed out only to a viewer its milestone's level allows (docs/product/FINISHERS.md, "Photos").
 *
 * The bucket is private and has no public address, so this route is the only way to a picture, and it checks every time: the
 * member it is about always; another signed-in member at the house or the globe; a visitor only at the globe while the member's
 * page is on (the `writer_profiles` flag and the page itself); staff who are not that member only when the member ticked "Share my
 * story". The address carries a random token, never an id of ours. The bytes are streamed from here, not redirected to a signed
 * link, so there is no second address that outlives a change of level. Anything that is not allowed is the same 404 as a photo
 * that does not exist, with no cache, so nothing says that a hidden photo is there.
 */
const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

async function viewerOf(repos: ReturnType<typeof getServiceRepos>): Promise<PhotoViewer> {
  const user = await getCurrentUser();
  if (!user) return ANONYMOUS_VIEWER;
  // The effective identity: a staff member viewing as a member (sudo) is that member, as everywhere else in the app.
  const [identity, isStaff] = await Promise.all([getEffectiveIdentity(user).catch(() => null), repos.profiles.isAdmin(user.id).catch(() => false)]);
  return { signedIn: true, memberId: identity?.memberId ?? null, isStaff };
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  if (!isPhotoToken(token)) return NOT_FOUND();
  try {
    const repos = getServiceRepos();
    const record = await repos.milestones.photoByToken(token);
    if (!record) return NOT_FOUND();

    const viewer = await viewerOf(repos);
    // The web rule is asked only when it could matter: the globe, which is the only level a visitor can ever have.
    const webOn = record.level === "public" && (await memberHasWriterProfiles(repos, record.ownerId)) && (await repos.writerProfiles.isOnForMember(record.ownerId));
    const decision = decidePhotoAccess({ ownerId: record.ownerId, level: record.level, consentTestimonial: record.consentTestimonial }, viewer, webOn);
    if (!decision.allowed) return NOT_FOUND();

    const bytes = await milestonePhotoStore(createServiceRoleClient()).download(record.path);
    if (!bytes) return NOT_FOUND();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": photoCacheControl(decision.cache),
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, noimageindex",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    console.error("[milestone-photo] Serving a photo failed", error instanceof Error ? error.message : String(error));
    return new NextResponse("Something went wrong", { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
