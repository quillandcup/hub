import { Render, type Data } from "@puckeditor/core";
import { faqStructuredData } from "@/lib/landing/faq-schema";
import { withPopupFormIds } from "@/lib/landing/exit-popup";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { jsonLdScript } from "@/lib/writer-profile-seo";
import type { PageBlockRegistry } from "./block-registry";
import { withStandIns } from "./block-placeholder";
import { buildRenderConfig, pageBlocks, renderConfig, renderConfigFor, type FrameContext } from "./config";

/**
 * A landing page's document, rendered on the server with the same blocks the editor shows. The document is cleaned
 * again here (rich text to the allowlist, links to safe ones) whatever was stored, so the public page never trusts the
 * database to have been clean. Used by the public route and the admin preview. A website page passes its `frame`, which
 * brings in the site's shared header and footer (the published copy for visitors, the draft in the preview).
 *
 * A stored block that nothing in the block registry owns (its module is not installed) draws nothing instead of breaking the
 * page (block-placeholder.tsx). `registry` is for tests that build a composition without a module; the page uses the installed one.
 *
 * `structuredData` is set by the published public route only (never the admin preview, never the editor's canvas, which does not use
 * this component): it adds the page's FAQ as schema.org JSON-LD (`faqStructuredData`). That is a data block, not a script that runs, so
 * the per-request nonce of src/lib/csp.ts does not apply to it (as for the writer profile's); `jsonLdScript` escapes `<`.
 */
export default function LandingRender({ data, frame, registry = pageBlocks, structuredData = false }: { data: unknown; frame?: FrameContext; registry?: PageBlockRegistry; structuredData?: boolean }) {
  const clean = withPopupFormIds(sanitizeLandingData(data));
  const base = registry === pageBlocks ? renderConfig : buildRenderConfig(registry);
  const config = withStandIns(frame ? renderConfigFor(frame, base) : base, clean, registry, false);
  const faq = structuredData ? faqStructuredData(clean) : null;
  return (
    <>
      <Render config={config} data={clean as unknown as Data} />
      {faq && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faq) }} />}
    </>
  );
}
