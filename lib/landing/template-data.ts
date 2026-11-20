import type { LandingTemplateRepository } from "@/lib/data/landing-templates";
import { normalizeLandingData, type LandingData } from "@/lib/landing/data";
import { stampLandingVersion } from "@/lib/landing/migrations";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { isLandingTemplateId } from "@/lib/landing/templates";

export const TEMPLATE_GONE = "That template no longer exists.";

/**
 * A saved template's document, ready to become a page's draft: brought up to date with the block migrations and cleaned again
 * as a save cleans it (rich text and links), whatever the database holds. Nothing here publishes or touches a page's title,
 * address or search settings; the caller puts it in a draft.
 */
export async function loadTemplateDraft(repo: LandingTemplateRepository, templateId: unknown): Promise<{ ok: true; data: LandingData; name: string } | { ok: false; error: string }> {
  if (!isLandingTemplateId(templateId)) return { ok: false, error: TEMPLATE_GONE };
  const template = await repo.byId(templateId);
  if (!template) return { ok: false, error: TEMPLATE_GONE };
  return { ok: true, data: sanitizeLandingData(stampLandingVersion(normalizeLandingData(template.data))), name: template.name };
}
