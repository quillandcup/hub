"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction, type AdminActionAuth } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { createRepos } from "@/lib/data/repos";
import { PROSPECT_STATUSES, isProspectId, type ProspectStatus } from "@/lib/data/prospects";
import { importPastedProspects, type ImportSummary } from "@/lib/prospecting/import";
import { blueskySource } from "@/lib/prospecting/sources/bluesky";
import { runSource, type SourceRunSummary } from "@/lib/prospecting/sources/run";

const MAX_PASTE_LENGTH = 200_000;
const MAX_REASON_LENGTH = 200;

export type ImportResult = { error: string } | { summary: ImportSummary };

type Auth = Extract<AdminActionAuth, { ok: true }>;

async function importProspectsImpl(auth: Auth, text: string): Promise<ImportResult> {
  if (!text.trim()) return { error: "Paste at least one handle or profile link." };
  if (text.length > MAX_PASTE_LENGTH) return { error: "That is too much to import at once; paste fewer lines." };

  const summary = await importPastedProspects(createRepos(auth.supabase), text, auth.user.id);
  revalidatePath("/admin/outreach/prospects");
  return { summary };
}

async function reviewProspectImpl(auth: Auth, id: string, status: string, rejectReason?: string): Promise<{ error: string } | { ok: true }> {
  if (!isProspectId(id)) return { error: "Unknown prospect." };
  if (!PROSPECT_STATUSES.includes(status as ProspectStatus)) return { error: "Unknown status." };

  await createRepos(auth.supabase).prospects.review(id, status as ProspectStatus, auth.user.id, rejectReason?.trim().slice(0, MAX_REASON_LENGTH) || null);
  revalidatePath("/admin/outreach/prospects");
  return { ok: true };
}

async function searchForProspectsImpl(auth: Auth): Promise<{ error: string } | { summaries: SourceRunSummary[] }> {
  // One source today; the list is where the next one goes (Instagram needs Meta's app review first).
  const repos = createRepos(auth.supabase);
  const summaries = [await runSource(repos, blueskySource, auth.user.id)];
  revalidatePath("/admin/outreach/prospects");
  return { summaries };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function importProspects(text: string): Promise<ImportResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("prospects_imported", () => importProspectsImpl(auth, text));
}

export async function reviewProspect(id: string, status: string, rejectReason?: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("prospect_reviewed", () => reviewProspectImpl(auth, id, status, rejectReason));
}

export async function searchForProspects(): Promise<{ error: string } | { summaries: SourceRunSummary[] }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("prospects_searched", () => searchForProspectsImpl(auth));
}
