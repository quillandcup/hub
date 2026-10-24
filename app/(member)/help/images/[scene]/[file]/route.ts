import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { HELP_IMAGES_BUCKET, isHelpImagePath } from "@/lib/help";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * A screenshot for a help article, from the private help-images bucket. Any signed-in member; the bucket has no
 * storage policies, so this route (after the sign-in check) is the only way to it. The image is the same for
 * everyone, but it sits behind the sign-in check, so it is cached by the browser only (`private`).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ scene: string; file: string }> }) {
  const { scene, file } = await params;
  if (!isHelpImagePath(scene, file)) return new NextResponse("Not found", { status: 404 });

  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data, error } = await createServiceRoleClient().storage.from(HELP_IMAGES_BUCKET).download(`${scene}/${file}`);
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(data, {
    headers: { "Content-Type": data.type || "image/png", "Cache-Control": "private, max-age=3600" },
  });
}
