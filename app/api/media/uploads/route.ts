import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { MEDIA_BUCKET } from "@/lib/media/library";

/**
 * A signed URL to upload a file straight to storage, for one too big for a request body (Vercel allows
 * about 4.5 MB). Upload to it, then confirm with `POST /api/media { uploadPath }`, which checks what the
 * file is and moves it into the library.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const path = `uploads/${randomUUID()}`;
  const { data, error } = await createServiceRoleClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("Couldn't create a media upload URL:", error?.message);
    return NextResponse.json({ error: "Couldn't start the upload" }, { status: 500 });
  }
  return NextResponse.json({ uploadPath: path, signedUrl: data.signedUrl, token: data.token });
}
