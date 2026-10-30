import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { parseLookEdit } from "@/lib/media/edit";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createClient } from "@/lib/supabase/server";

/** The member and their own image, or the response to give instead. Someone else's image is a plain 404. */
async function ownAsset(assetId: string) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { response: NextResponse.json({ error: "No member record" }, { status: 403 }) };
  if (!isId(assetId, "media")) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const media = createRepos(await createClient()).media;
  const asset = await media.byId(assetId);
  if (!asset || asset.deleted_at || asset.owner_member_id !== identity.memberId) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { media, asset };
}

/** A member reads one of their own images (a cover they uploaded), for the crop editor. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const found = await ownAsset((await params).assetId);
  if ("response" in found) return found.response;
  return NextResponse.json({ asset: found.asset, usages: [] });
}

/** A member changes how their own cover is framed: its focal point and how a picture of another shape fits. Nothing else about it. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const body = await request.json().catch(() => undefined);
  if (body === undefined || typeof body !== "object" || body === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const found = await ownAsset((await params).assetId);
  if ("response" in found) return found.response;
  const look = parseLookEdit(body, found.asset);
  if ("error" in look) return NextResponse.json({ error: look.error }, { status: 400 });
  try {
    const asset = await found.media.edit(found.asset.id, look.edit);
    return asset ? NextResponse.json({ asset }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("Error editing a member's cover:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
