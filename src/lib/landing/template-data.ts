import type { LandingPageRepository } from "@/lib/data/landing-pages";
import { normalizeLandingData, type LandingData } from "@/lib/landing/data";
import { stampLandingVersion } from "@/lib/landing/migrations";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { isLandingPageId } from "@/lib/landing/slug";

export const TEMPLATE_GONE = "That template is no longer available.";

/**
 * A template's PUBLISHED document, ready to become a page's draft: never its draft, and only while the template is published.
 * It is brought up to date with the block migrations and cleaned again as a save cleans it (rich text and links), whatever the
 * database holds. Nothing here publishes or touches a page's title, address or search settings; the caller puts it in a draft.
 */
export async function loadTemplateDraft(repo: Pick<LandingPageRepository, "usableTemplateData">, templateId: unknown): Promise<{ ok: true; data: LandingData; name: string } | { ok: false; error: string }> {
  if (!isLandingPageId(templateId)) return { ok: false, error: TEMPLATE_GONE };
  const template = await repo.usableTemplateData(templateId);
  if (!template) return { ok: false, error: TEMPLATE_GONE };
  return { ok: true, data: sanitizeLandingData(stampLandingVersion(normalizeLandingData(template.data))), name: template.title };
}
