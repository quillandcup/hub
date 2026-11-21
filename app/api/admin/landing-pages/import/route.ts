import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { createRepos } from "@/lib/data/repos";
import { importKajabiExport, type ImportOutcome } from "@/lib/landing/kajabi-import-service";
import { ZIP_LIMITS } from "@/lib/landing/kajabi-zip";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * "Import from Kajabi" (docs/product/LANDING_PAGES.md): an admin uploads a Kajabi page export (zip) and gets a draft page.
 * Multipart form data: `file` (the zip, at most ZIP_LIMITS.archiveBytes), `title` (the export has none), and `confirm`
 * ("true") to replace a draft that holds changes the import would lose. A route and not a server action because the
 * upload outgrows an action's default body limit; the admin check is the same one actions use. The archive is read in
 * memory (lib/landing/kajabi-zip.ts) and never written to disk.
 *
 * Answers `{ status: "imported" | "confirm" | "error", ... }` (see ImportOutcome); a refused request is 401/403/400.
 */
export const maxDuration = 120;

async function handle(request: NextRequest): Promise<{ response: NextResponse; outcome: ImportOutcome | null }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.error === "Not authenticated" ? 401 : 403 }), outcome: null };

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > ZIP_LIMITS.archiveBytes + 64 * 1024) return { response: NextResponse.json({ status: "error", error: "That file is too large for a page export." }, { status: 413 }), outcome: null };
  const form = await request.formData().catch(() => undefined);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return { response: NextResponse.json({ status: "error", error: "Choose the exported zip file." }, { status: 400 }), outcome: null };
  if (file.size > ZIP_LIMITS.archiveBytes) return { response: NextResponse.json({ status: "error", error: "That file is too large for a page export." }, { status: 413 }), outcome: null };

  const repos = createRepos(auth.supabase);
  let outcome: ImportOutcome;
  try {
    outcome = await importKajabiExport(
      { pages: repos.landingPages, media: repos.media, storage: createServiceRoleClient().storage },
      { archive: new Uint8Array(await file.arrayBuffer()), title: String(form?.get("title") ?? ""), confirm: form?.get("confirm") === "true", userId: auth.user.id, year: new Date().getFullYear() },
    );
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

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function POST(request: NextRequest): Promise<Response> {
  let outcome: ImportOutcome | null = null;
  const response = await withAction(
    "landing_page_imported",
    async () => {
      const result = await handle(request);
      outcome = result.outcome;
      return result.response;
    },
    (r) => ({ ok: r.status === 200 && (outcome?.status === "imported" || outcome?.status === "confirm"), detail: outcome?.status === "confirm" ? "needs_confirm" : undefined }),
  );
  return response;
}
