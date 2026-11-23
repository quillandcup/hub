import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireActionPermission } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { createRepos } from "@/lib/data/repos";
import { importKajabiExport, inspectKajabiExport, type ImportOutcome, type ImportTarget, type InspectOutcome } from "@/lib/landing/kajabi-import-service";
import { ZIP_LIMITS } from "@/lib/landing/kajabi-zip";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * "Import from Kajabi" (docs/product/LANDING_PAGES.md): an admin uploads a Kajabi page export (zip) and gets a draft page.
 * Multipart form data: `file` (the zip, at most ZIP_LIMITS.archiveBytes), then either `mode=inspect` (read it and write
 * nothing: what it starts with, a suggested title, the pages that look like it) or an import with `title` (the export has
 * none) and what it is: `asNew=true`, or `replacePageId` (the page whose draft it replaces). With neither, an export that
 * looks like a page already here is not imported: the answer is "choose". A route and not a server action because the
 * upload outgrows an action's default body limit; the admin check is the same one actions use. The archive is read in
 * memory (src/lib/landing/kajabi-zip.ts) and never written to disk.
 *
 * Answers `{ status: "inspected" | "imported" | "choose" | "error", ... }` (see InspectOutcome, ImportOutcome); a refused request is 401/403/400.
 */
export const maxDuration = 120;

async function handle(request: NextRequest): Promise<{ response: NextResponse; outcome: ImportOutcome | InspectOutcome | null }> {
  const auth = await requireActionPermission("pages.edit");
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.error === "Not authenticated" ? 401 : 403 }), outcome: null };

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > ZIP_LIMITS.archiveBytes + 64 * 1024) return { response: NextResponse.json({ status: "error", error: "That file is too large for a page export." }, { status: 413 }), outcome: null };
  const form = await request.formData().catch(() => undefined);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return { response: NextResponse.json({ status: "error", error: "Choose the exported zip file." }, { status: 400 }), outcome: null };
  if (file.size > ZIP_LIMITS.archiveBytes) return { response: NextResponse.json({ status: "error", error: "That file is too large for a page export." }, { status: 413 }), outcome: null };

  const repos = createRepos(auth.supabase);
  const archive = new Uint8Array(await file.arrayBuffer());
  const year = new Date().getFullYear();
  let outcome: ImportOutcome | InspectOutcome;
  try {
    if (form?.get("mode") === "inspect") outcome = await inspectKajabiExport({ pages: repos.landingPages }, { archive, year });
    else {
      const replacePageId = String(form?.get("replacePageId") ?? "");
      const target: ImportTarget | undefined = replacePageId ? { kind: "replace", pageId: replacePageId } : form?.get("asNew") === "true" ? { kind: "new" } : undefined;
      outcome = await importKajabiExport(
        { pages: repos.landingPages, media: repos.media, storage: createServiceRoleClient().storage },
        { archive, title: String(form?.get("title") ?? ""), target, userId: auth.user.id, year },
      );
    }
  } catch (error) {
    console.error("landing page import failed:", error instanceof Error ? error.message : String(error));
    outcome = { status: "error", error: "Couldn't import that page. Nothing was lost; try again." };
  }
  if (outcome.status === "imported") {
    revalidatePath("/admin/pages");
    revalidatePath(`/p/${outcome.slug}`);
  }
  return { response: NextResponse.json(outcome, { status: outcome.status === "error" ? 400 : 200 }), outcome };
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
export async function POST(request: NextRequest): Promise<Response> {
  let outcome: ImportOutcome | InspectOutcome | null = null;
  const response = await withAction(
    "landing_page_imported",
    async () => {
      const result = await handle(request);
      outcome = result.outcome;
      return result.response;
    },
    (r) => ({ ok: r.status === 200 && (outcome?.status === "imported" || outcome?.status === "choose" || outcome?.status === "inspected"), detail: outcome?.status === "choose" ? "needs_choice" : outcome?.status === "inspected" ? "inspect" : undefined }),
  );
  return response;
}
