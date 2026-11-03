import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { extractTrackbearExport, TrackbearImportError } from "@/lib/trackbear-import";
import { createRepos } from "@/lib/data/repos";
import { runTrackbearImport } from "@/lib/trackbear-import-runner";
import { makeTrackbearCoverCopier } from "@/lib/trackbear-cover";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { withAction } from "@/lib/analytics/server";

export const maxDuration = 300; // 5 minutes (max for Hobby tier)

// Vercel caps request bodies at 4.5MB; a TrackBear export is JSON + CSVs, zipped, so even
// years of daily tallies fit comfortably.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Imports the acting member's TrackBear "Export your data" download (.zip, or the
 * trackbear-progress-data.json inside it) into their writing projects. Safe to repeat: rows
 * already imported are skipped, so re-uploading a newer export brings over only what's new.
 */
async function handlePost(request: NextRequest, onCounts?: (counts: string) => void) {
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
      createRepos(supabase).writing,
      effectiveIdentity.memberId,
      data,
      makeTrackbearCoverCopier(createRepos(supabase).media, createServiceRoleClient().storage)
    );
    console.log("TrackBear import:", effectiveIdentity.memberId, JSON.stringify(result.created));
    // What came over, for the usage record: counts only.
    onCounts?.(`p${result.created.projects} e${result.created.entries} g${result.created.goals}`);

    revalidatePath("/projects", "layout");
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

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function POST(request: NextRequest): Promise<Response> {
  let counts: string | undefined;
  return withAction(
    "trackbear_imported",
    async () => (await handlePost(request, (c) => (counts = c))) as Response,
    (response) => (response.status < 400 ? { ok: true, detail: counts } : { ok: false, detail: String(response.status) })
  );
}
