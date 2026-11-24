import { NextRequest, NextResponse } from "next/server";
import { requireActionPermission } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { getServiceRepos } from "@/lib/data/server";
import { suggestKajabiAltTexts } from "@/lib/landing/kajabi-import-service";
import { ZIP_LIMITS } from "@/lib/landing/kajabi-zip";
import { hitRateLimits } from "@/lib/rate-limit";

/**
 * Suggested descriptions for the pictures of a Kajabi page export (docs/product/LANDING_PAGES.md, "Importing from Kajabi", "Picture
 * descriptions"). Multipart form data: `file` (the same zip the import takes). Answers `{ status: "suggested", suggestions, ai }` or
 * `{ status: "error", error }`; nothing is written. The model, when set up, sees only the headings near each picture, never a
 * picture; without it (or when it fails) the suggestions come from rules, and `ai` says which. The guard is the import's own
 * (`pages.edit`, as for Build with AI), plus a limit per person because each call can spend a model request.
 */
export const maxDuration = 120;

const PER_ADMIN = { windowSeconds: 3600, maxHits: 40 };

async function handle(request: NextRequest): Promise<{ response: NextResponse; ok: boolean }> {
  const auth = await requireActionPermission("pages.edit");
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.error === "Not authenticated" ? 401 : 403 }), ok: false };

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > ZIP_LIMITS.archiveBytes + 64 * 1024) return { response: NextResponse.json({ status: "error", error: "That file is too large for a page export." }, { status: 413 }), ok: false };
  const form = await request.formData().catch(() => undefined);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return { response: NextResponse.json({ status: "error", error: "Choose the exported zip file." }, { status: 400 }), ok: false };
  if (file.size > ZIP_LIMITS.archiveBytes) return { response: NextResponse.json({ status: "error", error: "That file is too large for a page export." }, { status: 413 }), ok: false };

  const allowed = await hitRateLimits(getServiceRepos(), [{ bucket: `kajabi_alt_text:user:${auth.user.id}`, ...PER_ADMIN }]);
  if (!allowed) return { response: NextResponse.json({ status: "error", error: "Too many requests for suggestions. Please wait a little and try again." }, { status: 429, headers: { "Retry-After": String(PER_ADMIN.windowSeconds) } }), ok: false };

  try {
    const outcome = await suggestKajabiAltTexts({ archive: new Uint8Array(await file.arrayBuffer()), year: new Date().getFullYear() });
    return { response: NextResponse.json(outcome, { status: outcome.status === "error" ? 400 : 200 }), ok: outcome.status === "suggested" };
  } catch (error) {
    console.error("landing page import alt text failed:", error instanceof Error ? error.message : String(error));
    return { response: NextResponse.json({ status: "error", error: "Couldn't suggest descriptions. You can write them yourself." }, { status: 400 }), ok: false };
  }
}

// Usage analytics: recorded under the import's own event (src/lib/analytics/server.ts).
export async function POST(request: NextRequest): Promise<Response> {
  let ok = false;
  return withAction(
    "landing_page_imported",
    async () => {
      const result = await handle(request);
      ok = result.ok;
      return result.response;
    },
    () => ({ ok, detail: "alt_text" }),
  );
}
