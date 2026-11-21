import { Render, type Data } from "@puckeditor/core";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
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
 */
export default function LandingRender({ data, frame, registry = pageBlocks }: { data: unknown; frame?: FrameContext; registry?: PageBlockRegistry }) {
  const clean = sanitizeLandingData(data);
  const base = registry === pageBlocks ? renderConfig : buildRenderConfig(registry);
  const config = withStandIns(frame ? renderConfigFor(frame, base) : base, clean, registry, false);
  return <Render config={config} data={clean as unknown as Data} />;
}
