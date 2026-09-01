import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { imageSize } from "image-size";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import {
  BOOK_COVER_ALLOWED_TYPES,
  validateBookCoverDimensions,
  validateBookCoverFile,
} from "@/lib/bookCover";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return NextResponse.json({ error: "No member record" }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const fileError = validateBookCoverFile(file);
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  let dimensions: { width?: number; height?: number };
  try {
    dimensions = imageSize(buffer);
  } catch {
    return NextResponse.json({ error: "Couldn't read that image file" }, { status: 400 });
  }
  if (!dimensions.width || !dimensions.height) {
    return NextResponse.json({ error: "Couldn't read that image file" }, { status: 400 });
  }

  const dimensionError = validateBookCoverDimensions(dimensions.width, dimensions.height);
  if (dimensionError) return NextResponse.json({ error: dimensionError }, { status: 400 });

  const extension = EXTENSION_BY_TYPE[file.type as (typeof BOOK_COVER_ALLOWED_TYPES)[number]];
  const path = `${effectiveIdentity.memberId}/${randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("book-covers")
    .upload(path, buffer, { contentType: file.type });
  if (uploadError) {
    console.error("Book cover upload failed:", uploadError);
    return NextResponse.json({ error: "Upload failed, try again" }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("book-covers").getPublicUrl(path);

  return NextResponse.json({ url: publicUrl });
}
