import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { extractTrackbearExport, TrackbearImportError } from "@/lib/trackbear-import";
import { runTrackbearImport } from "@/lib/trackbear-import-runner";
import { makeTrackbearCoverCopier } from "@/lib/trackbear-cover";

export const maxDuration = 300; // 5 minutes (max for Hobby tier)

// Vercel caps request bodies at 4.5MB; a TrackBear export is JSON + CSVs, zipped, so even
// years of daily tallies fit comfortably.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Imports the acting member's TrackBear "Export your data" download (.zip, or the
 * trackbear-progress-data.json inside it) into their writing projects. Safe to repeat: rows
 * already imported are skipped, so re-uploading a newer export brings over only what's new.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return NextResponse.json({ error: "No member record" }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is too large to be a TrackBear export." }, { status: 400 });
  }

  let data;
  try {
    data = extractTrackbearExport(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof TrackbearImportError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  try {
    const result = await runTrackbearImport(
      supabase,
      effectiveIdentity.memberId,
      data,
      makeTrackbearCoverCopier(supabase)
    );
    console.log("TrackBear import:", effectiveIdentity.memberId, JSON.stringify(result.created));

    revalidatePath("/projects");
    revalidatePath("/dashboard");
    revalidatePath(`/members/${effectiveIdentity.memberId}`);
    return NextResponse.json(result);
  } catch (err) {
    console.error("TrackBear import failed:", effectiveIdentity.memberId, err);
    return NextResponse.json(
      {
        error:
          "The import stopped partway. Anything already imported is saved -- upload the same file again to finish.",
      },
      { status: 500 }
    );
  }
}
